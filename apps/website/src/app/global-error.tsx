'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Something went wrong</h1>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
