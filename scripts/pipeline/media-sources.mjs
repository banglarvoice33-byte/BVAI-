import { findTopics, financialOrSensitive } from './visual-topics.mjs';

export function buildQueries({ title_bn = '', category_key = '' } = {}) {
  const topics = findTopics(title_bn);
  const sensitive = financialOrSensitive(title_bn);
  // শুধু বিশ্বকাপ লেখা থাকলে কোনো খেলা অনুমান করা যাবে না।
  const ambiguous = /বিশ্বকাপ|world cup/i.test(title_bn) && !/ক্রিকেট|ফুটবল|cricket|football|champions league|চ্যাম্পিয়ন্স/i.test(title_bn);
  if (ambiguous) return { topics: [], queries: [], sensitive };
  const queries = topics.length ? topics.map((t) => t[1]) : [];
  return { topics, queries, sensitive };
}
