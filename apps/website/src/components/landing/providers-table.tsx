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
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h3 className="text-2xl font-semibold">Version control providers</h3>
      <p className="text-fd-muted-foreground mt-3">
        GitLab, Bitbucket and other providers are not currently supported.
        Providers share an interface in <code>libs/vcs/</code> — contributions
        adding support for other providers are welcome.
      </p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-fd-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-fd-card">
            <tr>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 font-medium">Authentication</th>
              <th className="px-4 py-2 font-medium">Test coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fd-border">
            {providers.map((provider) => (
              <tr key={provider.name}>
                <td className="px-4 py-2 font-medium">{provider.name}</td>
                <td className="px-4 py-2">{provider.auth}</td>
                <td className="text-fd-muted-foreground px-4 py-2">
                  {provider.coverage}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
