import { redirect } from 'next/navigation'

// No separate sign-up flow anymore — /sign-in already lets a new visitor
// create an account from the same form. This route only exists so old
// links/bookmarks (and Clerk's own internal "continue sign-up" redirects,
// which used to strand people on an incomplete sign-up page) land
// somewhere useful instead of a dead end.
export default function SignUpPage() {
  redirect('/sign-in')
}
