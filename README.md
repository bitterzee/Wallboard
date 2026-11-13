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

## Rie's calendar
Menu → **Rie's calendar** (on the phone: the button at the bottom of Today, or tap the Rie card). Add daycare, swimming, doctor visits or anything else. Repeating things (daycare every weekday) can skip a single day. Today's plans and the next doctor visit show on the wall.

## Rie: growth and development
Menu → **Rie** has three tabs. **Calendar** (with packing lists), **Growth** (birthday, height and weight with WHO percentiles for girls 0–5 years, charted against the 3rd–97th percentile bands) and **Development** (what most children can do at her age and ideas to try, summarised from CDC's "Learn the Signs. Act Early." milestones). One idea a week shows on the wall.
Growth data is stored in `wb_state` (`rie_profile`, `rie_growth`), members only like everything else.
