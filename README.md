# Wallboard

Your family wall display: weather, family photos and a shared recipe book. It runs on the iPad and uses the Capcus Supabase project (`trip-ledger`), with every table prefixed `wb_`.

## Already done
- Tables, access rules, the private `wallboard` photo bucket, live updates and 4 starter recipes are set up in the `trip-ledger` project.
- Only emails listed in `wb_members` can see or change anything. Right now that's just you.

## Add your wife
In Supabase, open the SQL editor and run:

    insert into wb_members (email, display_name) values ('her@email.com', 'Her name');

She signs in with her Capcus login. If she doesn't have one, create her in Authentication → Users → Add user, with a password.

## Host it (pick one, about 2 minutes)
- **Netlify Drop**: on a computer, go to app.netlify.com/drop and drag this whole folder onto the page.
- **Vercel**: run `npx vercel` inside this folder.
- **GitHub Pages**: push this folder to a repo and turn on Pages.

## Set up the iPad
1. Open the site in Safari, then tap Share → **Add to Home Screen**.
2. Open Wallboard from the Home Screen and sign in once with your Capcus email: it emails you a code, same as Capcus.
3. Settings → Display & Brightness → Auto-Lock → **Never**. Keep it plugged in.
4. Settings → Accessibility → **Guided Access** → On. In Wallboard, triple-click the Home button to lock the iPad to it.

## Using it
- Tap the screen for **Layout**, **Mode**, **Recipes** and **Photos**.
- **Layout** opens the chooser: B (photo + weather on the left, recipe on the right, all day) or C (changes through the day). The choice is saved in Supabase, so either of you can change it, from the iPad or from **Wall layout** in the recipe book on your phone. The first time it opens, it asks you to pick one.
- In layout C, **Mode** cycles Auto → Morning → Day → Dinner → Night.
- Auto switches by time of day: Morning from 5:00, Day from 10:00, Dinner from 16:00 and Night from 21:00. To change the times, edit `CONFIG` at the top of `index.html`.
- On your phones, the same site opens straight into the recipe book, so either of you can add recipes and photos or choose **Cook this tonight**. The wall updates within a second or two.
- `supabase.sql` is the full setup script, kept for reference. You don't need to run it again.
