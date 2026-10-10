import { createDocumentClient } from '@trackify/data';
import { parseArguments, setPlan } from './plan';

const input = parseArguments(process.argv.slice(2));
console.info(JSON.stringify(await setPlan(createDocumentClient(), input), null, 2));
