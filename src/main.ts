import { getBets, getAllMarkets, placeBet } from "./api";

const TARGET_BET_AMOUNT = 5;
const LOW_SAMPLE_BET_AMOUNT = 1;


const main = async () => {
  const username = process.env.MANIFOLD_USERNAME;
  const key = process.env.MANIFOLD_API_KEY;

  if (!username)
    throw new Error("Please set MANIFOLD_USERNAME variable in .env file.");
  if (!key)
    throw new Error("Please set MANIFOLD_API_KEY variable in .env file.");

  var fs = require('fs');

  var target_no = fs.readFileSync('target_no.txt')
      .toString() // convert Buffer to string
      .split('\n') // split string to lines
      .map(e => e.trim()) // remove white spaces for each line
      .map(e => e.split(',').map(e => e.trim())) // split each line to array
      .flat(2);

  var target_yes = fs.readFileSync('target_yes.txt')
      .toString() // convert Buffer to string
      .split('\n') // split string to lines
      .map(e => e.trim()) // remove white spaces for each line
      .map(e => e.split(',').map(e => e.trim())) // split each line to array
      .flat(2);

  var balanced = fs.readFileSync('balanced.txt')
      .toString() // convert Buffer to string
      .split('\n') // split string to lines
      .map(e => e.trim()) // remove white spaces for each line
      .map(e => e.split(',').map(e => e.trim())) // split each line to array
      .flat(2);

  console.log("Starting coinflip trading bot...");

  const markets = await getAllMarkets();

  let lastBetId: string | undefined = undefined;
  let lastProbability: number | undefined = undefined;

  while (true) {
    // poll every 15 seconds
    if (lastBetId !== undefined) await sleep(15 * 1000);
    const markets = await getAllMarkets();
    
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const roundProb = (prob: number) => Math.round(prob * 100) / 100;

if (require.main === module) {
  main();
}
