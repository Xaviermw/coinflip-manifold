import { getBets, getAllMarkets, getMarkets, placeBet, cancelBet } from "./api";

const TARGET_USERS = require('./new_targets.json'); 
//const TARGET_BET_AMOUNT = 5;
//const LOW_SAMPLE_BET_AMOUNT = 1;
const BET_DELAY = 1
//const FIXED_BARRIER = 0.05

const main = async () => {
  const username = process.env.MANIFOLD_USERNAME;
  const key = process.env.MANIFOLD_API_KEY;

  if (!username)
    throw new Error("Please set MANIFOLD_USERNAME variable in .env file.");
  if (!key)
    throw new Error("Please set MANIFOLD_API_KEY variable in .env file.");
   // Write Historical Market Data
   const markets_dump = await getAllMarkets();
   const markets_string = JSON.stringify(markets_dump);
   var fs = require('fs');
    fs.writeFile('./src/markets.json', markets_string, err => {
      if (err) {
        console.error(err);
      }
      // file written successfully
    });
  var bet_list = []
  console.log("Starting coinflip trading bot...");
  let lastMarketId: string | undefined = undefined;
  var total_bets = 0
  while (true) {
    var count_bets = 0
    try {
      const markets = await getMarkets();
      var date = Date.now()
      for (let i = 0; i < markets.length; i++) {
        var market = markets[i]
        if (market.volume == 0) {
          if (!market.isResolved && market.outcomeType == "BINARY" && !bet_list.includes(market.id)) {
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
              } else if (target_user.username == "levifinkelstein") {
                console.log("Avoiding ".concat(creator))
              } else if (date >= market.closeTime) {
                console.log(creator.concat(" market expired"))
              } else if (target_user.target == "Target Yes") {
                console.log("Target Yes Bet Against ".concat(creator))
                console.log(market.question)
                var bet_percentage_limit = target_user.lower_ci
                if (bet_percentage_limit > 0.95) {
                  bet_percentage_limit = 0.95
                }
                var liquidity = market.totalLiquidity
                var bet_amount = (liquidity-(2*liquidity*bet_percentage_limit))/(2*(bet_percentage_limit-1))
                var bet_amount_round_down = Math.floor(bet_amount)
                console.log("Betting " + bet_amount_round_down + " up to " + (bet_percentage_limit*100).toFixed(0) + "%")
                bet_percentage_limit = Number(bet_percentage_limit.toFixed(2))
                if (market.probability == .5) {
                  var newbet = await placeBet({
                      contractId: market.id,
                      amount: (bet_amount_round_down),
                      outcome: "YES"
                  });
                  sleep(6 * 1000);
                  cancelBet(newbet.id)
                  sleep(6 * 1000);
                  cancelBet(newbet.contractId)
                  bet_list.push(market.id)
                  count_bets = count_bets + 1
                  sleep(BET_DELAY * 1000);
                } else {
                  console.log("Starting Probability not 50%")
                }
                lastMarketId = market.id
              } else if (target_user.target == "Target No") {
                console.log("Target No Bet Against ".concat(creator))
                console.log(market.question)
                var bet_percentage_limit = target_user.upper_ci
                if (bet_percentage_limit < 0.05) {
                  bet_percentage_limit = 0.05
                }
                var bet_amount = (1/2)*market.totalLiquidity*((1/bet_percentage_limit)-2)
                var bet_amount_round_down = Math.floor(bet_amount)
                console.log("Betting " + bet_amount_round_down + " down to " + (bet_percentage_limit*100).toFixed(0) + "%")
                bet_percentage_limit = Number(bet_percentage_limit.toFixed(2))
                if (market.probability == .5) {
                    var newbet = await placeBet({
                      contractId: market.id,
                      amount: (bet_amount_round_down),
                      outcome: "NO"
                  });
                  sleep(6 * 1000);
                  cancelBet(newbet.id)
                  sleep(6 * 1000);
                  cancelBet(newbet.contractId)
                  bet_list.push(market.id)
                  count_bets = count_bets + 1
                  sleep(BET_DELAY * 1000);
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
