# Junk Drawer: spec

Junk Drawer is one place on the owner's Android phone for the small HTML web
apps that Claude or Gemini make for them. The owner downloads an HTML file,
adds it to Junk Drawer, and from then on finds and uses it there.

This file says what the app does. How it's built is for plans; where a
platform limit forces a behaviour, the limit is stated next to it.

## Words

- **page**: one self-contained HTML file in the library, with its name, tags,
  pin, open count, dates and saved data.
- **library**: the list of pages. Junk Drawer's home screen.
- **saved data**: whatever a page stores in the browser to remember its state
  between uses.

## Platform

- An installed PWA on current Chrome for Android, named "Junk Drawer" on the
  home screen. The repo and URL keep the name `webapp-browser`.
- Desktop Chrome works well enough to develop and test on. No other browser
  is a target.
- One person, one device. No accounts, backend or sync.
- Junk Drawer and every page in it open with no connection. A page that loads
  things from the internet gets the network as it would in a browser tab and
  fails offline in its own way; Junk Drawer doesn't cache those for it.
- The installed app picks up new deploys without a reinstall, and an update
  never loses the library or any saved data.

## Adding a page

1. The owner taps "add new page" in the library. Android's file picker opens
   for one `.html` or `.htm` file.
2. Junk Drawer copies the file's contents into its own storage. From here on
   the page never depends on the file in Downloads.
3. **Same-name check.** If a page already in the library has the same name or
   the same file name, Junk Drawer asks: replace that page, or add as a new
   one. The comparison ignores case and the " (1)" suffix Android adds to
   repeat downloads. Replace follows [Replacing a file](#replacing-a-file);
   add as new carries on.
4. **Details step.** Name, prefilled from the file's `<title>`, or from the
   file name without its extension when there's no title; editable. Tags,
   optional: pick from tags already in use or type new ones. Cancelling here
   adds nothing.
5. The page joins the library.
6. **Delete the original?** Junk Drawer asks whether to delete the downloaded
   file. See [the limit](#deleting-the-original) below.
7. **Open it?** Junk Drawer asks whether to view the new page now or go back
   to the library.

### Deleting the original

A web app can only delete a file the owner picked through Chrome's File
System Access picker (`showOpenFilePicker`, Chrome for Android 132 and up),
using `FileSystemHandle.remove()`. Whether that works on a file in Downloads
is unconfirmed; see [Confirm on the phone](#confirm-on-the-phone).

- Where it can't work, step 6 never appears and the rest of the flow is
  unchanged.
- A failed delete never undoes the add. Junk Drawer says the file is still
  there and moves on.

## The library

Junk Drawer always opens to the library.

- **One list.** Each page appears once, showing its name and tags.
- **Pins.** Pinned pages sit above the rest. The current sort applies inside
  each group.
- **Sorts:** name, recently opened, recently added, most opened. A page that
  has never been opened counts by its added date under "recently opened". The
  chosen sort is remembered between launches.
- **Tag filter.** One chip per tag in use. Tapping a chip toggles it. With
  several on, only pages that have all of them show; with none on, every page
  shows. Pinned pages that don't match are hidden too. The filter clears on
  each launch.
- **Tags** are free text, stored lowercase and trimmed, so "Games" and
  "games" are one tag. A tag exists while some page has it; there is no
  separate tag list to manage.
- **Per-page actions:** open (tap the page), pin or unpin, edit name and
  tags, replace file, remove.
- **Empty library:** says what Junk Drawer is for and offers "add new page".

Opening a page adds one to its open count and sets its last-opened time.

## Viewing a page

- The page shows inside Junk Drawer under a slim top bar with the page's name
  and a "library" button. The bar is always visible.
- Android's back gesture returns to the library, which keeps its scroll
  position, sort and filter. Back from the library leaves the app.
- Every open loads the page fresh. Only saved data carries over.
- The page behaves as it would in a browser tab: scripts, network requests,
  `alert`/`confirm`/`prompt`, clipboard, fullscreen, and files it offers for
  download. It may ask for camera, microphone or location; Android's prompt
  names Junk Drawer, and a grant covers every page.
- A link to another site opens in the browser. Nothing a page does replaces
  the top bar or navigates Junk Drawer itself away.

## Saved data

Every page runs on Junk Drawer's one web origin, so the browser gives pages
no separation from each other for free. Worked example: a workout tracker and
a tip splitter both save under the key `state`, and the tip splitter's reset
button calls `localStorage.clear()`. Left alone, opening the tip splitter
shows workout data, and its reset wipes the workout history and Junk Drawer's
own library. The app has to build the separation. The same origin
(`finitezombie.github.io`) also serves the owner's other GitHub Pages sites,
so Junk Drawer's own storage needs names that can't collide with theirs.

A page's saved data:

1. **Persists** across views, app restarts, phone restarts and Junk Drawer
   updates. Junk Drawer asks the browser for persistent storage so Chrome
   doesn't evict it.
2. **Is private to the page.** Two pages using the same key never see each
   other's values. Clearing storage in one page touches no other page and
   never the library.
3. **Survives replacing the file.**
4. **Is deleted when the page is removed.**
5. **Is readable by Junk Drawer**, page by page, so backup can export it.

`localStorage` meets all five. `sessionStorage` works and lasts one view.
`IndexedDB` works and persists; if a plan can't also make it private per page
and readable for backup, it says so and asks the owner rather than quietly
dropping a rule. Cookies and the Cache API carry no promise.

A page starts with empty saved data in Junk Drawer, even if the same file
saved data earlier when opened straight from Downloads in Chrome.

## Replacing a file

For a new version of a page already in the library. Reached from the page's
"replace file" action, or from the same-name check while adding.

- The new file's contents replace the old.
- Name, tags, pin, open count, dates and saved data stay as they are. The
  name stays even when the new file's `<title>` differs.
- The delete-the-original and open-it questions follow, as in adding.

## Removing a page

- Junk Drawer confirms first, saying the page and its saved data will be
  deleted for good.
- Remove deletes Junk Drawer's copy and the page's saved data. There is no
  undo or trash.
- Remove never touches Downloads.

## Later

Not in the first version. The first version must not make them hard.

- **Backup.** "export library" writes one file holding every page, its name,
  tags, pin, counts, dates and saved data; "restore library" reads it back.
  Clearing Chrome's data for the site or changing phone erases the library,
  and this is the only way to get it back.
- **Share sheet.** Junk Drawer appears in Android's share sheet for HTML
  files (Web Share Target) and a shared file enters the add flow at step 2.

## Not planned

Text search; a library grouped into tag sections; adding several files at
once; pages made of more than one file (an HTML with images or scripts beside
it); editing a page's HTML; renaming or merging tags; iOS, Firefox.

## Look and wording

Layout, colours, icons, the app icon, dialog wording and how per-page actions
are reached are the owner's to choose. Labels in this file are working labels,
lowercase. Where a choice isn't written down, use a neutral, obviously
temporary placeholder and list it in your report.

No state (pinned, chip on, error) is shown by colour alone, and never by red
against green.

## Confirm on the phone

Unproven on the owner's phone; a plan settles these before building on them.

1. Picking a file in Downloads with `showOpenFilePicker` and deleting it with
   `FileSystemHandle.remove()`, including the permission prompts Android
   shows. If it fails, pick files with `<input type="file">` and drop step 6.
2. `navigator.storage.persist()` is granted to the installed app.
