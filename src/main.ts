import { getBets, getAllMarkets, placeBet } from "./api";

const TARGET_USERS = require('./targets.json'); 
const TARGET_BET_AMOUNT = 5;
const LOW_SAMPLE_BET_AMOUNT = 1;
const BET_DELAY = 7
const LIMIT_BARRIER = 0.05

const main = async () => {
  const username = process.env.MANIFOLD_USERNAME;
  const key = process.env.MANIFOLD_API_KEY;

  if (!username)
    throw new Error("Please set MANIFOLD_USERNAME variable in .env file.");
  if (!key)
    throw new Error("Please set MANIFOLD_API_KEY variable in .env file.");

  var fs = require('fs');

  console.log("Starting coinflip trading bot...");
  let lastMarketId: string | undefined = undefined;
  var total_bets = 0
  while (true) {
    var count_bets = 0
    // poll every 15 seconds
    if (lastMarketId !== undefined) await sleep(BET_DELAY * 1000);
    try {
      const markets = await getAllMarkets();
      var date = Date.now()
      for (let i = 0; i < markets.length; i++) {
        var market = markets[i]
        if (market.volume == 0) {
          if (!market.isResolved && market.outcomeType == "BINARY") {
            var creator = market.creatorUsername
            if (!market.question.includes("Stock") && !market.question.includes("STOCK")) {
              var found = false
              for (let j = 0; j < TARGET_USERS.length; j++) {
                if (TARGET_USERS[j].username == creator) {
                  var target_user = TARGET_USERS[j]
                  found = true
                }
              }
              if (!found) {
                console.log("Target Isn't Known: ".concat(creator))
              } else if ( target_user.username == "levifinkelstein") {
                console.log("Avoiding ".concat(creator))
              } else if (date >= market.closeTime) {
                console.log(creator.concat(" market expired"))
              } else if (target_user.target == "Target Yes") {
                console.log("Target Yes Bet Against ".concat(creator))
                console.log(market.question)
                if (market.probability == .5) {
                  await placeBet({
                    contractId: market.id,
                    amount: TARGET_BET_AMOUNT,
                    outcome: "YES",
                    limitProb: .55
                  });
                  count_bets = count_bets + 1
                  await sleep(BET_DELAY * 1000);
                } else {
                  console.log("Starting Probability not 50%")
                }
                lastMarketId = market.id
              } else if (target_user.target == "Target No") {
                console.log("Target No Bet Against ".concat(creator))
                console.log(market.question)
                if (market.probability == .5) {
                  await placeBet({
                    contractId: market.id,
                    amount: TARGET_BET_AMOUNT,
                    outcome: "NO",
                    limitProb: .45
                  });
                  count_bets = count_bets + 1
                  await sleep(BET_DELAY * 1000);
                } else {
                  console.log("Starting Probability not 50%")
                }
                lastMarketId = market.id
                        
              } else if (target_user.target == "Balanced User") {
                console.log("Target Is Balanced: ".concat(creator))
              } else {
                console.log("Target Has Low Sample Size: ".concat(creator))
              }
            }
          }
        }
      }
    }
    catch(err) {
      console.log("Error: ".concat(err).concat("."));
    }
    finally {
      console.log("Bets Made This Iteration: ".concat(count_bets.toString()))
      total_bets = total_bets + count_bets
      console.log("Bets Made Total Since Bot Run: ".concat(total_bets.toString()))
      await sleep(BET_DELAY * 1000);  
    }
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const roundProb = (prob: number) => Math.round(prob * 100) / 100;

if (require.main === module) {
  main();
}
