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

## New in this version
- **Dinner plan**: plan the week's dinners. Today's shows on the wall, and tomorrow's appears underneath.
- **Shopping list**: one tap builds a list from the plan, merged and grouped by aisle. Tick items off in the shop, and it syncs between your phones.
- **Import a recipe from a link**: in Recipes, tap **Import link** and paste a recipe page. The Supabase function `import-recipe` reads it, and you check it before saving.
- **Rain alerts**: a banner warns when rain is likely in the next 12 hours.
- **On this day**: photos taken on today's date in past years appear in the slideshow with a label. The date comes from the photo itself.
- **iPhone layout**: on a phone, the site has tabs for Today, Recipes, Plan, Shopping and Photos.

## Also new
- **Hands-free cooking**: in cooking mode, tap **Hands-free** and say "next", "back", "repeat" or "ingredients". Indonesian works too ("lanjut", "kembali"). **Read aloud** reads each step.
- **What can I cook?**: tick what's in your kitchen, and recipes are ranked by how much you already have. The list is shared between you.
- **Family calendar**: in Settings, paste each person's Google Calendar secret iCal address. Today's events show on the wall and the phone. The `calendar` function reads the links, and only the household can see them.
- **Morning routine**: a picture checklist on the wall from 5 to 11 am, with a celebration when it's all ticked. Edit the steps in Settings.
- **WhatsApp**: the WhatsApp button on the shopping list sends the list as tidy text.
- On the iPad, tap the screen and use **Menu** (top right) for everything.

## Reviews and themes
- **Family reviews**: every recipe has a review each for Mom, Dad and Baby. Mom and Dad give 1 to 5 stars, and Baby gets a face, from 😋 Loved it to 🙅 Refused. A note is optional. Averages show in the recipe list, and **Top rated** sorts by them. When you finish cooking, the app asks you to review.
- **Themes**: in Settings, choose Jakarta rain, Bali, Shibuya, Snowboarding or Batik. The theme changes the wall and both phones.

## Importing from YouTube, Instagram and pictures
- **YouTube**: reads the video description. If the description only links to the creator's recipe page, it reads that page instead. If neither has the recipe, chapter titles become the steps. The video stays linked, and you can play it inside the recipe and in cooking mode.
- **Instagram**: reads the post caption. Private posts can't be read.
- **Photos and screenshots**: the text is read on your device in English and Indonesian (Tesseract.js), then sorted into ingredients and steps. Clear printed text works best.
- **Tried or new**: recipes you haven't made yet show **New**. Finishing cooking mode, or tapping **We made this today**, counts as made. Use the **New to try** and **Tried** filters in the recipe list.

## Shopping list and stock
- **In stock** (next to Shopping list): what's in the fridge, freezer and cupboard, with amounts and use-by dates. Items close to their date show under **Use soon** here, on the wall and on the Today screen.
- On a shopping list, tick items as you buy them, then tap **Put away** to move them into stock. Building the list from the dinner plan skips what's already in stock.
- Every recipe has **Add to shopping list**, and items already in stock start unticked. Each list item shows which recipes it's for, and tapping a name opens the recipe.
- **What can I cook?** uses the same stock, and prefers recipes that use up food to use soon.

## Scanning the fridge with AI
On **In stock**, tap **Scan photos**, take up to 4 photos of the fridge, freezer or cupboards, then check the list before adding. It uses Claude's vision through the `scan-stock` function.
To switch it on once: create a key at console.anthropic.com → API keys, then in Supabase open Edge Functions → Secrets and add `ANTHROPIC_API_KEY`. Each scan costs a few cents.

## Child's calendar
Menu → **Child's calendar** (on the phone: the button at the bottom of Today, or tap the child's card). Add daycare, swimming, doctor visits or anything else. Repeating things (daycare every weekday) can skip a single day. Today's plans and the next doctor visit show on the wall.

## Your child: growth and development
Menu → **(child's name)** has three tabs. **Calendar** (with packing lists), **Growth** (birthday, height and weight with WHO percentiles for girls 0–5 years, charted against the 3rd–97th percentile bands) and **Development** (what most children can do at her age and ideas to try, summarised from CDC's "Learn the Signs. Act Early." milestones). One idea a week shows on the wall.
Growth data is stored in `wb_state` (`kid_profile`, `kid_growth`), members only like everything else.

## YouTube videos without a written recipe
When a video's description has no recipe, `import-recipe` fetches the video's captions (the uploader's or YouTube's automatic ones) and asks Claude to write the recipe from what's said. Uses the same `ANTHROPIC_API_KEY` secret as fridge scanning. Videos with no captions can't be read.

## Claude features (v2026-11-13.30)

- **Ask the wall**: the sparkle button (top right, or floating on the phone). Type or speak. Claude can plan meals, add or tick shopping, update stock, start timers, add to the child's calendar and journal. Edge function `wall-ai`.
- **Weekly autopilot**: Meal plan → "Plan next week with Claude". On Sunday after 17:00 the wall drafts next week by itself and shows a banner; nothing changes until you tap "Use this plan".
- **Helper mode**: Settings → Household helper. The helper signs in with an email code and sees a simplified Bahasa Indonesia screen: today's meals with translated recipes, the child's schedule and packing list, shopping, and notes to the family. Edge function `helper-access`; RLS limits what helpers can read.
- **iCloud shared album**: Settings → Photos from an iCloud shared album. Turn on Public Website for the album and paste the link. The wall checks hourly. Edge function `icloud-sync`.
- **Memory book**: Menu → Memory book. Claude writes a page for the month from the journal, growth and photos. Print or save as PDF.
- **Story time** (v2026-11-13.31): from 18:30 the wall shows a "Story time" button (also in Menu). Claude writes a calm bedtime story in English or Bahasa from the child's real day; the wall can read it aloud. The last 30 stories are kept in `wb_state` "stories".
- **Vaccines and checkups**: a Vaccines tab on the child's page with IDAI's 2024 schedule plus routine checkups, computed from the birthday. Tick what's done; the next vaccine shows on the child's card a month ahead, and "Add to calendar" puts a doctor visit on her calendar. Saved in `wb_state` "kid_vax".

## Reliability and security (v2026-11-13.33)

**Keeps working when the internet drops**
- The last good copy of the household data is kept on each device. If the network or Supabase is down, the wall shows that copy with an "Offline" badge and retries on its own (10 s, 20 s, 40 s… up to every 5 minutes, and straight away when the device comes back online).
- A small service worker (`sw.js`) keeps the app itself, so the wall still opens after a reboot without internet. It's network-first, so updates still arrive straight away; it never stores household data.
- Every request has a time limit, the live-update connection reconnects by itself, and the twice-daily fresh start only happens when the internet is up.
- Weather: if Open-Meteo is down, the wall uses the last forecast (up to 36 hours old) or says "Weather unavailable". It never shows made-up weather, rain or air-quality warnings.
- Saving a setting that someone else changed at the same moment (two phones, or the wall and Claude) merges both changes instead of silently losing one.
- If drawing the wall ever fails, it falls back to a plain clock instead of a blank screen. Settings → Health shows the version, last sync and recent problems.

**Security**
- The database library is served from this site (`vendor/supabase-js-2.119.0.js`), pinned, not pulled from a CDN at run time. If it fails to load, the wall retries rather than falling back to demo data.
- A Content-Security-Policy limits where the page can load scripts from and send data to (Supabase, Open-Meteo, YouTube embeds, Google Fonts). No referrer is sent to other sites.
- All text from the database, imports and Claude is escaped before it's shown; links from imported recipes must be http(s).
- Edge functions only answer the wallboard's own site (CORS allowlist), refuse links to private or internal network addresses (also checking what a hostname resolves to), and cap Claude use at 200 calls per person per day (`wb_ai_tick`).
- Claude is told to treat recipes, notes and calendar text as information, never as instructions.
- Adding a helper can't touch a parent's account (case-insensitive check), and there can be at most 3 helpers.

**Recommended in the Supabase dashboard (can't be set from code)**
- Authentication → Sign In / Providers → turn off "Allow new users to sign up". Accounts are created only by you or the helper screen.
- Authentication → Rate Limits: keep the email OTP limits low.
