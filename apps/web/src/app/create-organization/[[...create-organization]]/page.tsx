import { redirect } from 'next/navigation'

// Team creation now happens inline in the Team tab (account menu) — no
// separate page needed. This route only exists so old links/bookmarks
// land somewhere useful.
export default function CreateOrganizationPage() {
  redirect('/dashboard/team')
}
