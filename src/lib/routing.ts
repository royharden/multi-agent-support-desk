export type Department = "billing" | "technical" | "account" | "uncertain";
export type Route = "billing" | "technical" | "account" | "human";
export type Priority = "P1" | "P2" | "P3";

export interface JevAnswers {
  department: {
    choice: Department;
    confidence: number;
    probabilities: Record<string, number>;
  };
  frustration: {
    score: number;
    confidence: number;
    legend: string[];
    probabilities: Record<string, number>;
  };
  urgent: number;
  needs_human: number;
}

export interface RoutingPolicy {
  humanThreshold: number;    // needs_human >= this -> human
  furyScore: number;         // frustration >= this -> human
  minDeptConfidence: number; // dept confidence < this -> human
  urgentThreshold: number;   // urgent >= this -> P1
  agentMinConfidence: number;// agent self_confidence < this -> human review
}

export const DEFAULT_POLICY: RoutingPolicy = {
  humanThreshold: 0.5,
  furyScore: 2.5,
  minDeptConfidence: 0.6,
  urgentThreshold: 0.6,
  agentMinConfidence: 0.5,
};

export interface TriageLike {
  needs_human: number;
  frustrationScore: number;
  department: Department;
  departmentConfidence: number;
}

export interface FiredRule {
  rule: string;
  detail: string;
}

export interface RoutingDecision {
  route: Route;
  priority: Priority;
  firedRules: FiredRule[];
}

export function route(
  answers: TriageLike,
  policy: RoutingPolicy = DEFAULT_POLICY
): RoutingDecision {
  const firedRules: FiredRule[] = [];

  if (answers.needs_human >= policy.humanThreshold) {
    firedRules.push({
      rule: "needs_human",
      detail: `needs_human ${answers.needs_human.toFixed(2)} >= threshold ${policy.humanThreshold}`,
    });
  }
  if (answers.frustrationScore >= policy.furyScore) {
    firedRules.push({
      rule: "fury_score",
      detail: `frustration ${answers.frustrationScore.toFixed(1)} >= fury threshold ${policy.furyScore}`,
    });
  }
  if (
    answers.department === "uncertain" ||
    answers.departmentConfidence < policy.minDeptConfidence
  ) {
    firedRules.push({
      rule: "department",
      detail:
        answers.department === "uncertain"
          ? "department is uncertain"
          : `department confidence ${answers.departmentConfidence.toFixed(2)} < minimum ${policy.minDeptConfidence}`,
    });
  }

  const route: Route =
    firedRules.length > 0 ? "human" : (answers.department as Exclude<Department, "uncertain">);

  const priority: Priority =
    answers.needs_human >= policy.urgentThreshold
      ? "P1"
      : answers.frustrationScore >= 1.5
        ? "P2"
        : "P3";

  return { route, priority, firedRules };
}
