# "Coin Flip" Trader

This bot uses the manifold market dump to identify high(ish) sample size users that tend to make binary markets that resolve relatively statistically significant (80% CI <.45 or >.55)  as "Yes" or "No", and will bet up/down to 45%/55% (just or 5 Mana) if the bot is the first trader.

Without the API fee, I would also have bet 1 Mana of "No" to all low sample size question makers as they resolve at like 47% no. 

No coins are flipped (if question making power users haven't noticed yet), this bot is a lie.

Yes, the code is bad (I'm a mediocre coder who doesn't know JavaScript), and yes I'm aware of sample bias, I'm just having fun here.