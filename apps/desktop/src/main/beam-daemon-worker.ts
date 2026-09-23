import { spawn } from 'node:child_process';

/**
 * The parent of the beam daemon the app owns. A utility process starts it
 * without the browser process's descriptors (profile locks among them),
 * which the daemon would otherwise hand to every process a peer starts
 * on this machine. It holds the daemon's stdin pipe open and never
 * writes to it, for `--exit-with-parent`: EOF there is the stop, closed
 * on request or by this process ending with the app. It passes the
 * daemon's stderr through, keeping the last line for why it exited, and
 * reports that exit.
 */
process.parentPort.once(
  'message',
  ({
    data,
  }: {
    data: { binary: string; args: string[]; env: Record<string, string> };
  }) => {
    const child = spawn(data.binary, data.args, {
      env: { ...process.env, ...data.env },
      stdio: ['pipe', 'inherit', 'pipe'],
    });
    let lastLine = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      const lines = chunk.toString('utf8').trim().split('\n');
      lastLine = lines[lines.length - 1] || lastLine;
    });
    child.once('error', (error) => {
      process.parentPort.postMessage({
        exited: { code: null, signal: null, error: error.message },
      });
      process.exit(1);
    });
    // `exit`, not `close`: a process the daemon started may still hold
    // its stderr. Its last words get a moment to arrive.
    const drained = new Promise<void>((resolve) => {
      child.stderr?.once('end', resolve);
      child.once('exit', () => setTimeout(resolve, 200));
    });
    child.once('exit', (code, signal) => {
      void drained.then(() => {
        process.parentPort.postMessage({ exited: { code, signal, lastLine } });
        process.exit(0);
      });
    });
    process.parentPort.on(
      'message',
      ({ data: m }: { data: { closeStdin?: true; kill?: true } }) => {
        if (m.closeStdin) child.stdin?.end();
        if (m.kill) child.kill('SIGKILL');
      }
    );
  }
);
