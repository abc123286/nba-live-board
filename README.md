# NBA boards

Two pages on the same site:
- **Odds board** (main page): https://abc123286.github.io/nba-live-board/
- **Live scores & lineups** (no odds): https://abc123286.github.io/nba-live-board/live.html

## Live scores & lineups

A live NBA scoreboard: scores, players on court, substitutions, full box scores and the day's top performers. No odds.

**Open it:** https://abc123286.github.io/nba-live-board/live.html (works on phones). Add `?demo=1` to see simulated games when nothing is on.

## What it shows
- **Scoreboard:** every game of the day (Malaysia date), live games first, refreshed every 10 seconds.
- **Top performers:** the day's best players ranked by game score (points, shooting efficiency, rebounds, assists, steals, blocks, minus fouls and turnovers), plus leaders for points, rebounds, assists, threes and steals + blocks.
- **Game view** (tap a game):
  - **Court:** both teams' five players on court, with points and fouls (5 fouls turns red). New players glow as they check in, and a pop-up announces each substitution.
  - **Substitutions:** every change, newest first, grouped by stoppage, filterable by team.
  - **Box score:** full stats for every player (sortable), team totals and shooting percentages; a green dot marks who's on court.
  - **Plays:** play-by-play, with a scoring-only filter.
- **Player card:** tap any player for their full stat line, shooting splits, when they checked in and out, and their recent plays.

## How "on court" works
ESPN's feed lists each team's starters and every substitution ("X enters the game for Y"). The page starts from the starters and applies each substitution in order.

## If the feed is blocked
Run the free helper on a computer: open this folder, right-click → **Open in Terminal**, type `py relay.py`, press Enter, keep the window open.

The odds board is the main page (`index.html`).
