import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type TerminalHandle } from '@wterm/react';
import wasmUrl from '@wterm/core/wasm?url';
import { toast } from 'sonner';
import {
  estimateTerminalGrid,
  measureTerminalGrid,
} from '../../lib/terminal-grid.js';
import { useTheme } from '../../lib/theme.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * One agent terminal bound to a host PTY. The component stays mounted
 * for as long as its tab is open (the editor hides inactive panes with
 * `visibility`), so the wterm instance keeps the full scrollback.
 *
 * On mount we replay the host's ring buffer for the session, then
 * stream live chunks — `seq` ordering lets us drop any live chunk that
 * was already part of the snapshot.
 */
export function SessionTerminal({
  name,
  epoch,
  active,
}: {
  name: string;
  /** When the PTY behind `name` was spawned. Restarting an agent keeps
   *  the name, so this is the only thing that changes when the process
   *  on the other end of this terminal is a new one. */
  epoch: number;
  active: boolean;
}) {
  const termRef = useRef<TerminalHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const { resolved } = useTheme();

  // Terminal responses and user input can race a session ending. Keep
  // the host's refusal visible without throwing an unhandled rejection
  // for every keystroke or automatic terminal-protocol response.
  const reportError = useCallback(
    (error: unknown) => {
      toast.error(errorMessage(error), { id: `terminal-io:${name}` });
    },
    [name]
  );
  const write = useCallback(
    (data: string) => {
      void window.n10.writeSession(name, data).catch(reportError);
    },
    [name, reportError]
  );
  const resize = useCallback(
    (cols: number, rows: number) => {
      void window.n10.resizeSession(name, cols, rows).catch(reportError);
    },
    [name, reportError]
  );

  // Seen-tracking: while the user is looking at this terminal, keep
  // the host's "last seen" fresh so the tab's attention blink never
  // fires for output they watched happen. Throttled — data can arrive
  // many times per second.
  const lastSeenMarkRef = useRef(0);
  const markSeen = useCallback(() => {
    const t = Date.now();
    if (t - lastSeenMarkRef.current < 1000) return;
    lastSeenMarkRef.current = t;
    void window.n10.markSessionSeen(name).catch(reportError);
  }, [name, reportError]);

  // Its own subscription, deliberately. The replay effect below must
  // not depend on `active`: re-running it re-reads the host's ring
  // buffer, so a tab switch would paste the entire scrollback in again.
  // Listening, on the other hand, is free — `onSessionData` is a bare
  // IPC event listener and the replay comes from `getSessionBuffer` —
  // so this half can come and go with the active tab on its own.
  useEffect(() => {
    if (!active || !ready) return;
    return window.n10.onSessionData(({ name: n }) => {
      if (n === name) markSeen();
    });
  }, [active, ready, name, markSeen]);

  useEffect(() => {
    if (!ready) return;
    const term = termRef.current;
    if (!term) return;

    let snapshotSeq: number | null = null;
    const pending: { seq: number; data: string }[] = [];

    const offData = window.n10.onSessionData(({ name: n, data, seq }) => {
      if (n !== name) return;
      if (snapshotSeq === null) {
        pending.push({ seq, data });
      } else if (seq > snapshotSeq) {
        term.write(data);
      }
    });

    // The replay must not land after this effect is torn down: React
    // StrictMode mounts twice in development, so a second replay would
    // duplicate the whole scrollback, and a pane closing mid-fetch
    // would write into a disposed terminal.
    let cancelled = false;
    void window.n10
      .getSessionBuffer(name)
      .then(({ data, seq }) => {
        if (cancelled) return;
        if (data) term.write(data);
        snapshotSeq = seq;
        for (const chunk of pending) {
          if (chunk.seq > seq) term.write(chunk.data);
        }
        pending.length = 0;
      })
      .catch(() => {
        if (cancelled) return;
        snapshotSeq = 0;
        for (const chunk of pending) term.write(chunk.data);
        pending.length = 0;
      });

    return () => {
      cancelled = true;
      offData();
    };
  }, [name, ready]);

  // Pasting a picture into the terminal.
  //
  // wterm's own paste handler reads `clipboardData.getData('text')` and
  // returns when there is none, so a copied screenshot lands nowhere
  // and the paste looks like it simply did not happen. A PTY carries
  // text, so the image cannot be forwarded as-is: the host writes it to
  // a temp file and we type the path, which is how a terminal agent
  // takes an image.
  //
  // Capture phase on the wrapper, so this runs before wterm's listener
  // on the textarea inside it. Text pastes are left alone — they fall
  // through to wterm, which already brackets and sanitises them.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !ready) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.items ?? [])]
        .find((i) => i.kind === 'file' && i.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const path = await window.n10.saveClipboardImage(bytes, file.type);
          // Trailing space so whatever the user types next does not run
          // into the path, and bracketed when the app asked for it —
          // the same shape wterm gives a text paste.
          const payload = `${path} `;
          const bracketed =
            termRef.current?.instance?.bridge?.bracketedPaste() === true;
          await window.n10.writeSession(
            name,
            bracketed ? `\x1b[200~${payload}\x1b[201~` : payload
          );
        } catch (err) {
          toast.error(errorMessage(err));
        }
      })();
    };
    el.addEventListener('paste', onPaste, true);
    return () => el.removeEventListener('paste', onPaste, true);
  }, [ready, name]);

  // Grab keyboard focus whenever this pane becomes the active tab, and
  // mark the session seen (clears the tab's attention blink).
  useEffect(() => {
    if (active && ready) {
      termRef.current?.focus();
      lastSeenMarkRef.current = 0; // force an immediate mark
      markSeen();
    }
  }, [active, ready, markSeen]);

  // Fit the terminal grid to its pane. autoResize stays ON (with it off
  // the react wrapper pins an inline height of rows*17px and keeps
  // re-applying its cols/rows props, clamping the terminal to ~24 rows).
  // wterm's own observer can still latch a stale size when the pane
  // mounts before layout settles, so this extra observer nudges
  // resize() from the wrapper's real box whenever it changes, using
  // wterm's measured cell metrics so the two observers agree.
  //
  // When the pane becomes the active tab again, a same-size resize is a
  // no-op all the way down (wterm repaints only dirty rows and the PTY
  // skips a same-size SIGWINCH), so the terminal can come back stale or
  // blank. Bouncing the grid one row forces the app to repaint the
  // whole screen — the same thing a manual window resize did.
  //
  // The host is told the grid on every fit, not only when wterm's own
  // grid moved. A launch can only *estimate* the pane, so the PTY starts
  // on a guess and is corrected by the first `onResize` wterm emits —
  // but restarting an agent in a pane that already holds a
  // correctly-sized terminal moves nothing, emits nothing, and left the
  // new agent drawing itself at the guess until the window was resized.
  // `epoch` is what makes this run again for the new process.
  useEffect(() => {
    if (!ready) return;
    const el = wrapRef.current;
    const term = termRef.current;
    const inst = term?.instance;
    if (!el || !term || !inst) return;
    let raf = 0;
    const fit = (forceRepaint = false) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const grid =
          measureTerminalGrid(inst.element, rect) ?? estimateTerminalGrid(rect);
        if (grid.cols !== inst.cols || grid.rows !== inst.rows) {
          term.resize(grid.cols, grid.rows);
          return;
        }
        resize(grid.cols, grid.rows);
        if (forceRepaint) {
          term.resize(grid.cols, grid.rows - 1);
          raf = requestAnimationFrame(() => term.resize(grid.cols, grid.rows));
        }
      });
    };
    fit(active);
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ready, active, resize, epoch]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Terminal
        ref={termRef}
        wasmUrl={wasmUrl}
        className="h-full w-full"
        theme={resolved === 'light' ? 'light' : undefined}
        autoResize
        cursorBlink
        onReady={(wt) => {
          setReady(true);
          if (active) wt.focus();
        }}
        onData={write}
        onResize={resize}
      />
    </div>
  );
}
