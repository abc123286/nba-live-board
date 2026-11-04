# NBA Live Value Board

A live dashboard for NBA games that suggests only bets priced at **decimal odds 2.00 or higher**.

- **Live game data** from the NBA's free live feed, every 4 seconds: score, clock, players on court, fouls, who's out.
- **Live odds** from Polymarket (free, no account needed to read). A price of 0.46 means about a 46% chance, which is decimal odds of about 2.17.
- **Live win-chance model**: starts from the pre-game market price, then updates for score, time left and starters fouling out.
- **Suggestions**: a side shows as VALUE when chance × odds − 1 beats your minimum edge. The stake is quarter-Kelly, capped at 2% of bankroll.
- **Signal log + optional sound** whenever a new VALUE signal appears.

## Use it

1. Turn on GitHub Pages: repo **Settings → Pages → Deploy from a branch → `main` / root**. Open the link it gives you.
2. Leave the page open during games. It refreshes on its own.
3. If the page says your browser can't reach the feeds, start the free helper (Windows):
   open the folder with `relay.py`, right-click an empty space → **Open in Terminal**, type `py relay.py`, press Enter.
   Keep that window open while you watch games. (Windows Smart App Control blocks `start-board.bat`, so use this instead.)
4. Want to see it working when no games are on? Add `#demo` to the end of the link (simulated games).

## Notes

- Polymarket's odds are not your bookie's odds. Type your bookie's price in **Your odds** to use it instead.
- Signals in the last 4 minutes of a game are skipped, because prices move too fast to act on.
- The model is simple. Markets usually catch up within seconds, so most live edges are small and short-lived. This is a tool for checking prices, not a guarantee.
