# Volleyball Tournament Live Scores

A free website for live scores, pool standings, seeding and playoff brackets.
Spectators open a link — no app or login. Scorekeepers log in with an **edit code**.

- **Hosting:** GitHub Pages (free, address like `https://YOURNAME.github.io/vb-scores/`)
- **Live data + edit code:** Firebase (free Spark plan, no credit card)

The site works immediately in **demo mode** (data stays in your own browser, code `demo123`)
so you can try it before doing the Firebase steps.

---

## Step 1 — Put the site on GitHub Pages (≈5 min)

1. Make a free account at github.com if you don't have one.
2. Click **+ → New repository**. Name it e.g. `vb-scores`, set it **Public**, click **Create**.
3. On the new repo page click **uploading an existing file**, drag in every file from this folder
   (`index.html`, `app.js`, `logic.js`, `store.js`, `config.js`, `style.css`, `firestore.rules`, `README.md`), then **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, Source = **Deploy from a branch**,
   Branch = **main**, folder **/ (root)**, **Save**.
5. Wait ~1 minute and refresh: the page shows your link, `https://YOURNAME.github.io/vb-scores/`.
   It runs in demo mode until you finish Step 2.

## Step 2 — Set up Firebase (≈15 min, one time)

1. Go to **console.firebase.google.com** → **Create a project** (name it anything, Google Analytics can be off).
2. **Database:** left menu **Build → Firestore Database → Create database**. Pick a US location
   (e.g. `nam5`), choose **production mode**, Create.
   Then open the **Rules** tab, delete what's there, paste the contents of `firestore.rules`, **Publish**.
3. **Edit code login:** **Build → Authentication → Get started → Email/Password → Enable → Save**.
   Then the **Users** tab → **Add user**:
   - Email: `scorekeeper@dukeclubvb.app` (doesn't need to be a real inbox; if you change it, change it in `config.js` and `firestore.rules` too)
   - Password: **your edit code** (Firebase requires at least 6 characters). This is what scorekeepers type.
4. **Allow your GitHub site to log in:** **Authentication → Settings → Authorized domains → Add domain** → `YOURNAME.github.io`.
5. **Get the config:** click the gear ⚙ → **Project settings** → *Your apps* → the **</>** (Web) icon →
   give it a nickname → Register (skip Hosting). Copy the `firebaseConfig = { ... }` object.
6. In GitHub, open `config.js` → pencil icon (edit) → replace `firebase: null,` with
   `firebase: { ...paste the object... },` → **Commit changes**.
7. Open your site (give it a minute to update), click **Scorekeeper login** at the bottom, enter the code,
   go to **Setup → Load Duke sample** (or **Create blank**), and you're live.

> The `apiKey` in config.js is meant to be public — Firebase security comes from the rules in Step 2,
> which only let the scorekeeper login write.

**Changing the edit code:** Authentication → Users → ⋮ next to the scorekeeper → Delete, then Add user again with the same email and the new code.
Anyone already logged in stays logged in until they tap "Log out", so change the code if a phone gets lost.

---

## Running a tournament

**Before the day (Setup tab)**
- Tournaments: *Create from this setup* copies teams/pools/format from the last event with no scores. *Show this one to everyone* picks which tournament the public link shows.
- Pools & teams: one team per line. Line order = team number in the schedule (1v2, 3v4 …). A 3-team pool automatically gets the double round robin; a 4-team pool gets your standard order with work teams. **Save setup.**
- Pool schedule: adjust any time, court, matchup or officiating team; it saves immediately.
- Match format, ranking order, and bracket ranges (Gold 1–8, Silver 9–16, Bronze 17–20) are all editable.
- **Download backup** before the event.

**During pool play (Score tab)** — one phone per court
- Pick the match, tap **+1** for each point. Sets advance automatically at 25 (win by 2, cap 27). The match goes Final after set 2.
- **−1** undoes a point (even after Final). **Type in scores** lets you enter finished scores instead of tapping.
- **Swap sides** just flips the display to match where teams stand.
- Post an **announcement** (shown at the top for everyone), e.g. "Playoffs start 3:45 in Wilson."

**After pool play (Setup → Seeding & playoffs)**
- Seeds update live from standings. Use ↑/↓ to adjust (this locks them), then **Build playoff brackets**.
- Set playoff times/courts in the table below. Winners advance automatically once a match is Final.

---

## Ranking rules (default)
1. Match record (win %, a 1-1 split counts as half a win)
2. Set win %
3. Point differential **per set** (fair when a pool has 3 teams and plays more matches)
4. Head-to-head (only between teams in the same pool)

"Overall stats across all pools" ranks everyone together. The alternative "Pool finish first" puts all pool winners ahead of all 2nd places, and so on.

## Free-tier limits
Firebase's free plan allows roughly 50,000 reads a day. To stay under it, spectators' screens refresh every 20 seconds
(and pause when the phone is locked or the tab is hidden); scorekeepers see changes instantly. Change `viewerRefreshSeconds` in `config.js` to adjust.
For instant updates for everyone with a big crowd, switch the project to the pay-as-you-go Blaze plan (a tournament costs pennies; set a budget alert).
