import { route, DEFAULT_POLICY } from "../src/lib/routing";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok - ${name}`);
  } else {
    console.error(`  FAIL - ${name}`);
    failures++;
  }
}

console.log("route() tests");

const calmBilling = {
  needs_human: 0.05,
  frustrationScore: 0.5,
  department: "billing" as const,
  departmentConfidence: 0.82,
};
let d = route(calmBilling);
check("calm invoice -> billing", d.route === "billing");
check("calm invoice -> P3", d.priority === "P3");
check("calm invoice -> no rules", d.firedRules.length === 0);

d = route({ ...calmBilling, frustrationScore: 1.8, needs_human: 0.1 });
check("annoyed -> still billing", d.route === "billing");
check("annoyed -> P2", d.priority === "P2");

d = route({ ...calmBilling, frustrationScore: 2.9 });
check("furious -> human", d.route === "human");
check("furious rule fired", d.firedRules.some((r) => r.rule === "fury_score"));

d = route({ ...calmBilling, needs_human: 0.9, frustrationScore: 3.2 });
check("hostile -> human + P1", d.route === "human" && d.priority === "P1");
check("needs_human rule fired", d.firedRules.some((r) => r.rule === "needs_human"));
check("fury rule also fired", d.firedRules.some((r) => r.rule === "fury_score"));

d = route({ ...calmBilling, department: "uncertain" as const });
check("uncertain dept -> human", d.route === "human");
check("uncertain rule fired", d.firedRules.some((r) => r.rule === "department"));

d = route({ ...calmBilling, departmentConfidence: 0.4 });
check("low dept confidence -> human", d.route === "human");
check("low-confidence rule fired", d.firedRules.some((r) => r.rule === "department"));

d = route(calmBilling, { ...DEFAULT_POLICY, humanThreshold: 0.02 });
check("custom policy respected", d.route === "human");

const urgentNonHuman = {
  needs_human: 0.1,
  frustrationScore: 0.4,
  department: "technical" as const,
  departmentConfidence: 0.75,
};
d = route(urgentNonHuman, { ...DEFAULT_POLICY, urgentThreshold: 0.6 });
check("urgent + confident -> technical P3 (urgent only affects priority)", d.route === "technical" && d.priority === "P3");
check("urgent does not fire a routing rule", d.firedRules.length === 0);

if (failures > 0) {
  console.error(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All routing tests passed.");
}
