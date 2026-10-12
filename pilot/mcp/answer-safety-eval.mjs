import OpenAI from 'openai';
import { safetyPayload } from './answer-safety.mjs';
import { cases, documentedSteps } from './answer-safety-fixtures.mjs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
let falseNegatives = 0;
let falsePositives = 0;
let inputTokens = 0;
let outputTokens = 0;
for (const [index, item] of cases.entries()) {
  const response = await client.responses.create(safetyPayload({ answer: item.text }, documentedSteps));
  const actual = JSON.parse(response.output_text);
  const predicted = actual.mentionsSource || actual.unsupportedAction;
  const expected = item.source || item.action;
  if (expected && !predicted) falseNegatives++;
  if (!expected && predicted) falsePositives++;
  inputTokens += response.usage?.input_tokens ?? 0;
  outputTokens += response.usage?.output_tokens ?? 0;
  console.log(`${index + 1}: esperado=${Number(expected)} previsto=${Number(predicted)}`);
}
const accuracy = (cases.length - falseNegatives - falsePositives) / cases.length;
const inputRate = Number(process.env.ASSISTANT_INPUT_USD_PER_MILLION ?? 10);
const outputRate = Number(process.env.ASSISTANT_OUTPUT_USD_PER_MILLION ?? 10);
const averageCostUsd = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000 / cases.length;
console.log(JSON.stringify({ accuracy, falseNegatives, falsePositives, inputTokens, outputTokens, averageCostUsd }));
if (falseNegatives) process.exitCode = 1;
