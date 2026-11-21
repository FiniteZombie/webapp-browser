# Phone check

Work through this once on your phone after the first deploy. It takes about
ten minutes. Each step is one action and says what you should see. If a step
doesn't match, make a note of its number and go on; the last section says
what to send.

## Install

1. Open `https://finitezombie.github.io/webapp-browser/` in Chrome.
2. Tap the three-dot menu, then "Add to home screen" or "Install app", and
   confirm.
3. Close Chrome. Find the new icon on the home screen.

## Checks

1. **Opens like an app.** Tap the icon. You should see Junk Drawer with no
   Chrome address bar or browser bars, and the icon's label says "Junk
   Drawer".
2. **Adding a page.** Download any HTML file to your phone first (a web app
   from Claude or Gemini will do). In Junk Drawer tap "add new page" and pick
   the file from Downloads. You should get a details step, then a sheet that
   says the page was added.
   - If tapping "add new page" does nothing, or the picker comes back
     empty-handed: scroll to the bottom of the library, tap "use the simple
     picker", and try again. Note that you had to.
   - If you are on the simple picker: cancel the picker once, then tap "add
     new page" again. It should still open the picker.
3. **Deleting the download.** On the sheet after adding, look for a "delete
   the downloaded file from this phone" box. If it isn't there, say so and go
   to step 4. If it is: tick it, tap "back to library", and note every prompt
   Android shows. Then open the Files app and look in Downloads: the file
   should be gone. If it's still there, Junk Drawer should have said so.
4. **Press and hold.** Press and hold a row in the library. An action sheet
   should open (pin, edit, replace file, remove). No text selection and no
   Chrome menu should appear. Close the sheet.
5. **Back gesture.**
   1. Tap a row to open a page, then swipe back. You should land in the
      library.
   2. In the library, swipe back. You should leave the app.
   3. Open the app again, press and hold a row so the action sheet is open,
      then swipe back. Only the sheet should close.
6. **A page with several screens.** Open a page that has screens of its own
   (tabs, a menu, a settings view). Go to a second screen and swipe back. You
   should return to the first screen; swiping back again leaves for the
   library. The "library" button at the top should always go straight to the
   library.
7. **Links.** Open a page that links to another website and tap the link. It
   should open in Chrome. Return to Junk Drawer: the page should look as you
   left it.
8. **No connection.** Turn on aeroplane mode. Close the app from the recents
   screen and open it again. The library should appear and a page should
   open.
9. **Saved data.** In a page that remembers things (a counter, notes, a
   to-do list), change something. Close the app from recents and reopen the
   page: the change should be there. Restart the phone and check again.
10. **Storage warning.** Look at the top of the library. Is there a warning
    that the phone may clear your pages? It should go away once the app is
    installed. If it is still there after a day of use, report it.
11. **Camera or location.** Open a page that asks for the camera or your
    location. Android's prompt should name Junk Drawer.
12. **Updates.** After the next deploy: open the app, wait a few seconds,
    and look at the build line at the bottom of the library. It should have
    changed, and nothing you added or saved should be missing.
13. **Only if you have such a page:** a page with a "preview" button that
    opens a view of its own should show the same saved data as the page
    itself.
14. **Export a page.** Open a page and tap "export" in the top bar. If a
    sheet offers "share…", tap it: Android's share sheet should open with an
    .html file (try sending it to Drive or the Claude app). Export again and
    pick "save to downloads": the file should appear in Downloads under its
    original name. If no sheet appears, the file should go straight to
    Downloads; note that.
15. **Export the library.** In the library footer tap "export library". A
    "backup ready" dialog should say how many pages there are. Note whether
    it offers "share…" (Chrome may not share zip files). Save or share it,
    and check the .zip arrives where you sent it.
16. **Import the library.** Use a second phone if you have one; otherwise
    rename a page in the library first. Tap "import library", pick the zip
    (from Downloads, or from Drive in the picker's menu). It should say how
    many pages it will replace and add, then that it imported them. A page's
    saved data (step 9) should be as it was when you exported.

## If something's off

Tap "copy diagnostics" at the bottom of the library (or "copy details" on an
error message), and paste it to an agent along with the step number. If the
app shows "Junk Drawer didn't start", copy what's in the box on that screen
instead.
