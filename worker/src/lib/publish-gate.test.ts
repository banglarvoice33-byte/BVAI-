import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_AI_SCORE,
  SOURCE_DUE_GRACE_MINUTES,
  computeScore,
  consecutive403Count,
  decidePublish,
  repairBodyForGate,
  isAutoPublish,
  isSourceDue,
  licenceNoteAllowsReuse,
  shouldDisableAfter403,
  type PublishGateInput,
  type SourceFetchOutcome,
} from "./publish-gate.js";

const BN_BODY =
  "ঢাকার আবহাওয়া দপ্তর জানিয়েছে আজ শহরে হালকা বৃষ্টির সম্ভাবনা আছে এবং নগরবাসীকে সতর্ক থাকতে বলা হয়েছে। " +
  "সকাল থেকে আকাশ মেঘলা ছিল তবে যানবাহন চলাচল স্বাভাবিক রয়েছে বলে জানা গেছে। " +
  "বিশেষজ্ঞরা বলছেন এ ধরনের আবহাওয়া কৃষিকাজে সহায়ক হতে পারে যদি বৃষ্টি মাত্রাতিরিক্ত না হয়। " +
  "স্থানীয় প্রশাসন জরুরি সেবা প্রস্তুত রেখেছে এবং নাগরিকদের খোলা স্থানে সতর্কতার পরামর্শ দিয়েছে। " +
  "এই প্রতিবেদন শুধুমাত্র উৎসে প্রকাশিত তথ্যের ভিত্তিতে লেখা হয়েছে এবং কোনো অতিরিক্ত দাবি যোগ করা হয়নি। " +
  "নগরবাসী ছাতা সঙ্গে রাখতে পারেন এবং অপ্রয়োজনীয় ভ্রমণ এড়িয়ে চলতে পারেন বলে পরামর্শ দিয়েছেন কর্মকর্তারা। " +
  "সন্ধ্যা নাগাদ পরিস্থিতি পুনরায় মূল্যায়ন করা হবে বলে জানিয়েছে আবহাওয়া দপ্তর।";

const BN_SOURCE =
  "আবহাওয়া অধিদপ্তর ঢাকায় আজ হালকা বৃষ্টির পূর্বাভাস দিয়েছে। মেঘলা আকাশ ও স্বাভাবিক যানচলাচলের কথা বলা হয়েছে। " +
  "কৃষিকাজে সহায়কের সম্ভাবনা এবং জরুরি সেবা প্রস্তুত রাখার তথ্য উৎসে আছে। উন্মুক্ত স্থানে সতর্ক থাকতে বলা হয়েছে।";

const BN_TITLE = "ঢাকায় হালকা বৃষ্টির পূর্বাভাস";

function baseInput(overrides: Partial<PublishGateInput> = {}): PublishGateInput {
  const now = Date.now();
  return {
    autoPublish: true,
    sourceEnabled: true,
    killSwitch: false,
    sourceUrl: "https://example.com/news/1",
    imageUrl: "https://images.pexels.com/photos/1.jpeg",
    isFallback: false,
    rewriteMethod: "ai",
    bodyBn: BN_BODY,
    titleBn: BN_TITLE,
    sourceText: BN_SOURCE,
    imageSource: "pexels",
    licenceAllowsReuse: false,
    sourcePublishedAt: new Date(now - 60 * 60 * 1000).toISOString(),
    category: "national",
    now,
    minAiScore: DEFAULT_MIN_AI_SCORE,
    ...overrides,
  };
}

function runWith(status: SourceFetchOutcome["status"], key: string) {
  const outcome: SourceFetchOutcome = { status, at: "2026-10-02T00:00:00.000Z" };
  return { details: { sources: { [key]: outcome } } };
}

describe("publish gate", () => {
  it("publishes a clean AI article", () => {
    expect(decidePublish(baseInput()).action).toBe("publish");
  });

  it("defaults auto-publish ON for trusted syndicated sources; false/0/off is the emergency stop", () => {
    expect(isAutoPublish({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isAutoPublish({ AUTO_PUBLISH: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isAutoPublish({ AUTO_PUBLISH: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isAutoPublish({ AUTO_PUBLISH: "OFF" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isAutoPublish({ AUTO_PUBLISH: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("treats public RSS licence notes as reusable", () => {
    expect(licenceNoteAllowsReuse("Public RSS")).toBe(true);
    expect(licenceNoteAllowsReuse("all rights reserved")).toBe(false);
  });

  it("holds when AUTO_PUBLISH is off", () => {
    const result = decidePublish(baseInput({ autoPublish: false }));
    expect(result.action).toBe("hold");
    expect(result.reason).toBe("auto_publish_disabled");
  });

  it("does not block world-class copy on the closed sensitivity gate", () => {
    const result = decidePublish(baseInput({
      titleBn: "সংবাদে খুনের ঘটনা",
      aiSensitive: true,
      aiSensitivityFailed: true,
    }));
    expect(result.action).toBe("publish");
    expect(result.riskLevel).toBe("high");
  });

  it("never holds an article for its image: fallback images publish as labelled symbolic images", () => {
    const result = decidePublish(baseInput({ isFallback: true }));
    expect(result.action).toBe("publish");
    expect(result.representationalImage).toBe(true);
    expect(result.imageReason).toBe("image_fallback");
  });

  it("publishes with the own headline card as a symbolic image (was image_not_related hold)", () => {
    const result = decidePublish(baseInput({
      imageSource: "brand-card",
      imageUrl: "https://banglar-voice.example/api/brand-card?title=x",
    }));
    expect(result.action).toBe("publish");
    expect(result.representationalImage).toBe(true);
  });

  it("does not flag a licensed topic image as representational", () => {
    const result = decidePublish(baseInput());
    expect(result.action).toBe("publish");
    expect(result.representationalImage).toBe(false);
  });

  it("still holds on text fidelity even when the image is symbolic", () => {
    const result = decidePublish(baseInput({
      imageSource: "brand-card",
      imageUrl: "https://banglar-voice.example/api/brand-card?title=x",
      bodyBn: BN_BODY + " সরকার ৯৯৯ কোটি টাকা বরাদ্দ দিয়েছে।",
    }));
    expect(result.action).toBe("hold");
    expect(result.reason).toBe("number_not_in_source");
  });

  it("holds non-AI rewrites", () => {
    const result = decidePublish(baseInput({ rewriteMethod: "fallback" }));
    expect(result.action).toBe("hold");
    expect(result.reason).toBe("rewrite_not_ai");
  });

  it("rejects articles older than 48 hours", () => {
    const now = Date.now();
    const result = decidePublish(
      baseInput({ now, sourcePublishedAt: new Date(now - 49 * 60 * 60 * 1000).toISOString() }),
    );
    expect(result.action).toBe("reject");
    expect(result.reason).toBe("older_than_48h");
  });

  it("holds short bodies", () => {
    const result = decidePublish(baseInput({ bodyBn: "খুব ছোট" }));
    expect(result.action).toBe("hold");
    expect(result.reason).toBe("body_too_short");
  });

  it("keeps quality holds for short bodies and still scores medium-risk copy", () => {
    const input = baseInput({
      titleBn: "গ্রেপ্তার প্রতিবেদন প্রকাশ",
      minAiScore: 10,
    });
    const result = decidePublish(input);
    expect(result.action).toBe("publish");
    expect(result.riskLevel).toBe("medium");
    expect(computeScore(input)).toBeGreaterThanOrEqual(40);
  });

  it("disables after three consecutive final-403 runs including the current one", () => {
    const key = "src-1";
    const previous = [runWith("403", key), runWith("403", key)];
    expect(consecutive403Count(previous, key)).toBe(2);
    expect(shouldDisableAfter403(previous, key)).toBe(true);
  });

  it("does not disable after only two total 403 runs", () => {
    const key = "src-2";
    expect(shouldDisableAfter403([runWith("403", key)], key)).toBe(false);
  });

  it("resets the 403 streak on a non-403 run", () => {
    const key = "src-3";
    const previous = [runWith("ok", key), runWith("403", key), runWith("403", key)];
    expect(consecutive403Count(previous, key)).toBe(0);
    expect(shouldDisableAfter403(previous, key)).toBe(false);
  });

  it("applies the grace margin so interval=12 sources are due on a 10-minute run", () => {
    const now = Date.now();
    const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
    expect(SOURCE_DUE_GRACE_MINUTES).toBe(2);
    expect(isSourceDue(minutesAgo(10), 12, now)).toBe(true);
    expect(isSourceDue(minutesAgo(8), 12, now)).toBe(false);
    expect(isSourceDue(null, 12, now)).toBe(true);
  });
});

describe("repairBodyForGate", () => {
  const SRC = "ঢাকায় আজ হালকা বৃষ্টির পূর্বাভাস দিয়েছে আবহাওয়া অধিদপ্তর। তাপমাত্রা ২৮ ডিগ্রি সেলসিয়াস থাকতে পারে বলে জানানো হয়েছে।";
  const GOOD =
    "ঢাকার আবহাওয়া দপ্তর জানিয়েছে আজ শহরে হালকা বৃষ্টির সম্ভাবনা আছে এবং নগরবাসীকে সতর্ক থাকতে বলা হয়েছে। " +
    "সকাল থেকে আকাশ মেঘলা ছিল তবে যানবাহন চলাচল স্বাভাবিক রয়েছে বলে জানা গেছে। " +
    "বিশেষজ্ঞরা বলছেন এ ধরনের আবহাওয়া কৃষিকাজে সহায়ক হতে পারে যদি বৃষ্টি মাত্রাতিরিক্ত না হয়। " +
    "স্থানীয় প্রশাসন জরুরি সেবা প্রস্তুত রেখেছে এবং নাগরিকদের খোলা স্থানে সতর্কতার পরামর্শ দিয়েছে।";

  it("drops only the sentence that contains a number absent from the source", () => {
    const body = GOOD + " সরকার ৭৭৭ কোটি টাকা বরাদ্দ দিয়েছে। তাপমাত্রা ২৮ ডিগ্রি থাকতে পারে।";
    const r = repairBodyForGate(body, SRC);
    expect(r.changed).toBe(true);
    expect(r.droppedSentences).toBe(1);
    expect(r.body).not.toContain("৭৭৭");
    expect(r.body).toContain("২৮ ডিগ্রি");
    expect(r.notes).toContain("number_not_in_source");
  });

  it("keeps the source line and leaves clean text untouched", () => {
    const body = GOOD + "\nসূত্র: বিবিসি বাংলা https://example.com/a/1";
    const r = repairBodyForGate(body, SRC);
    expect(r.changed).toBe(false);
    expect(r.body).toBe(body);
  });

  it("returns the original when repair would leave the body too short", () => {
    const body = "সরকার ৭৭৭ কোটি টাকা বরাদ্দ দিয়েছে। আরও ৮৮৮ জন নিহত হয়েছেন বলে জানা গেছে।";
    const r = repairBodyForGate(body, SRC);
    expect(r.changed).toBe(false);
    expect(r.body).toBe(body);
  });

  it("drops a sentence copied verbatim from the source (identical_run)", () => {
    const copied = "ঢাকায় আজ হালকা বৃষ্টির পূর্বাভাস দিয়েছে আবহাওয়া অধিদপ্তর।";
    const r = repairBodyForGate(GOOD + " " + copied, SRC);
    expect(r.changed).toBe(true);
    expect(r.body).not.toContain("আবহাওয়া অধিদপ্তর");
    expect(r.notes).toContain("identical_run");
  });

  it("repaired text passes the gate that held the original", () => {
    const body = GOOD + " সরকার ৭৭৭ কোটি টাকা বরাদ্দ দিয়েছে।";
    expect(decidePublish(baseInput({ bodyBn: body, sourceText: SRC })).reason).toBe("number_not_in_source");
    const r = repairBodyForGate(body, SRC);
    expect(decidePublish(baseInput({ bodyBn: r.body, sourceText: SRC })).action).toBe("publish");
  });
});
