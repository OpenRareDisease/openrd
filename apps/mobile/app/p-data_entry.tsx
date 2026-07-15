import { Redirect, type Href } from 'expo-router';

/**
 * Data entry was promoted from a buried stack screen to the「记录」
 * tab — the single most frequent patient action deserves a tab slot
 * (it replaced the placeholder community tab). This redirect keeps
 * every pre-existing `router.push('/p-data_entry')` call site and
 * deep link working.
 *
 * The Href cast bridges expo-router's generated route types, which
 * only refresh on the next `expo start` — the route file exists in
 * this same commit.
 */
export default function DataEntryRedirect() {
  return <Redirect href={'/(tabs)/p-record' as Href} />;
}
