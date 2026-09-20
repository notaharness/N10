const providers = [
  {
    name: 'GitHub',
    auth: 'Authenticated gh CLI',
    coverage: 'Unit, offline end-to-end, and live integration',
  },
  {
    name: 'Azure DevOps',
    auth: 'Personal access token',
    coverage: 'Unit tests and recorded API responses; no live tests',
  },
];

export function ProvidersTable() {
  return (
    <section className="border-fd-border border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-20 md:grid-cols-12 md:gap-14 sm:py-24">
        <div className="min-w-0 md:col-span-5">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Version control providers
          </h2>
          <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
            GitLab, Bitbucket and other providers are not currently supported.
            Providers share an interface in <code>libs/vcs/</code> —
            contributions adding support for other providers are welcome.
          </p>
        </div>
        <div className="min-w-0 md:col-span-7">
          <div className="border-fd-border bg-fd-card overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="text-fd-muted-foreground text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium">Provider</th>
                  <th className="px-5 py-3 font-medium">Authentication</th>
                  <th className="px-5 py-3 font-medium">Test coverage</th>
                </tr>
              </thead>
              <tbody className="divide-fd-border border-fd-border divide-y border-t">
                {providers.map((provider) => (
                  <tr key={provider.name}>
                    <td className="px-5 py-3.5 font-medium whitespace-nowrap">
                      {provider.name}
                    </td>
                    <td className="px-5 py-3.5">{provider.auth}</td>
                    <td className="text-fd-muted-foreground px-5 py-3.5">
                      {provider.coverage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
