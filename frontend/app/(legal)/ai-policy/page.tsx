import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI নীতি',
  description: 'বাংলার ভয়েসের AI নীতি — AI-সহায়ক কনটেন্ট, মানব যাচাই, স্বচ্ছতা ও দায়িত্ব।',
};

export const dynamic = 'force-static';

export default function AiPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serifbn text-3xl font-extrabold">AI নীতি</h1>
      <p className="mt-2 text-sm text-neutral-500">সর্বশেষ হালনাগাদ: ১৯ নভেম্বর ২০২৬</p>

      <section className="mt-8 space-y-4 leading-relaxed">
        <h2 className="text-xl font-bold">১. আমরা AI কীভাবে ব্যবহার করি</h2>
        <p>
          বাংলার ভয়েসে AI ব্যবহার করা হয় খসড়া তৈরি, সারাংশ, অনুবাদ, শিরোনাম পরামর্শ, বানান ও তথ্য যাচাইয়ের
          সহায়তায়। কোনো লেখা, ছবি বা ভিডিও শুধু AI-এর উপর ছেড়ে দেওয়া হয় না।
        </p>
        <p>
          কোনো মডেলকে চূড়ান্ত সম্পাদকীয় সিদ্ধান্ত নিতে দেওয়া হয় না। প্রতিটি প্রকাশিত লেখার চূড়ান্ত দায়িত্ব
          মানুষ সম্পাদকের। কোনো মডেলকে তথ্য বানিয়ে লেখার, উৎস গোপন করার বা পাঠককে বিভ্রান্ত করার অনুমতি নেই।
        </p>
      </section>

      <section className="mt-8 space-y-4 leading-relaxed">
        <h2 className="text-xl font-bold">২. মানব যাচাই বাধ্যতামূলক</h2>
        <p>
          AI-এর তৈরি খসড়া প্রকাশের আগে সম্পাদক তথ্য, তারিখ, সংখ্যা, নাম ও উৎস যাচাই করেন। ভুল পাওয়া গেলে
          সংশোধন করা হয় এবং প্রয়োজনে সংশোধনী নোট দেওয়া হয়।
        </p>
      </section>

      <section className="mt-8 space-y-4 leading-relaxed">
        <h2 className="text-xl font-bold">৩. স্বচ্ছতা</h2>
        <p>
          AI-এর উল্লেখযোগ্য সহায়তা থাকলে লেখায় তা জানানো হয়। আমরা ১০০% নির্ভুলতা, নিরবচ্ছিন্ন সেবা বা
          পরিমাপ ছাড়া কোনো দাবি করি না।
        </p>
      </section>

      <section className="mt-8 space-y-4 leading-relaxed">
        <h2 className="text-xl font-bold">৪. মেধাস্বত্ব ও ন্যায্য ব্যবহার</h2>
        <p>
          আমরা অন্যের লেখা, ছবি বা ভিডিও হুবহু নকল করি না। উৎস উল্লেখ করি, অনুমতি ছাড়া কপিরাইটযুক্ত
          উপাদান ব্যবহার করি না। কেউ আপত্তি জানালে ৪৮ ঘণ্টার মধ্যে পর্যালোচনা করি।
        </p>
      </section>

      <section className="mt-8 space-y-4 leading-relaxed">
        <h2 className="text-xl font-bold">৫. আপনার তথ্য</h2>
        <p>
          AI প্রশিক্ষণের জন্য আপনার ব্যক্তিগত বার্তা বা গোপন তথ্য ব্যবহার করা হয় না। ভুল তথ্য পেলে
          আমাদের জানান, আমরা দ্রুত ঠিক করব।
        </p>
      </section>
    </main>
  );
}
