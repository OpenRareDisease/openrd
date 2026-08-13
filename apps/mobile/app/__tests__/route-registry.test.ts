import fs from 'node:fs';
import path from 'node:path';

/**
 * Every file in app/ has a <Stack.Screen> in _layout.tsx.
 *
 * _layout.tsx has said so in a comment for a long time, and nothing
 * checked it, so it drifted twice. Both times the symptom was the same
 * and both times it was invisible in development: a route with no entry
 * loses its declared title after hydration, which in WeChat's in-app
 * browser means a blank title bar and a link forwarded into a patient
 * group that renders as a bare URL. Commit 1e82bc6 fixed it for
 * p-genetics_family; five more routes had accumulated by the time
 * anyone looked again.
 *
 * Reading the source rather than importing it: _layout pulls in
 * expo-router, reanimated and the auth context, and this assertion is
 * about a list, not about rendering.
 */
const appDir = path.resolve(__dirname, '..');
const layout = fs.readFileSync(path.join(appDir, '_layout.tsx'), 'utf8');

/** `+html`, `+not-found` and `_layout` are expo-router's own files, not
 *  routes a Stack declares. */
const isRoute = (file: string) =>
  file.endsWith('.tsx') && !file.startsWith('+') && !file.startsWith('_');

const routeFiles = fs
  .readdirSync(appDir)
  .filter(isRoute)
  .map((file) => file.replace(/\.tsx$/, ''))
  .sort();

const declared = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((name) => !name.startsWith('('))
  .sort();

describe('app/ 里的每个路由都在 _layout 里声明过', () => {
  it('没有文件缺声明', () => {
    expect(routeFiles.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it('没有声明指向不存在的文件', () => {
    // The other direction matters too: a Stack.Screen for a route that
    // was renamed or deleted is a silent no-op, and it makes the list
    // look complete to the next person reading it.
    const dirs = fs
      .readdirSync(appDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(declared.filter((name) => !routeFiles.includes(name) && !dirs.includes(name))).toEqual(
      [],
    );
  });

  it('每个声明都带 title —— 没有 title 就是那个 bug 本身', () => {
    const withoutTitle = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"([^>]*)\/>/g)]
      .filter(([, name, rest]) => !name.startsWith('(') && !/title:/.test(rest))
      .map(([, name]) => name);
    expect(withoutTitle).toEqual([]);
  });
});
