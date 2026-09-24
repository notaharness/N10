/** Whether an enrolment's or revocation's directory write landed
 *  (beam docs/06: `published: true | "pending"`). Pending is not a
 *  failure: beam retries while it runs. */
export function publicationText(published: boolean): string {
  return published
    ? 'Published to directory'
    : 'Saved on this machine. Directory publication is pending; beam will retry while it runs.';
}
