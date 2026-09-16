import { Injectable } from '@nestjs/common';
import type { StageDef, ValidationIssue } from '@reefcraft/shared';

/**
 * §14.3/§16 — save-time validation. Phase 1 checks only what the one-stage
 * smoke blueprint needs to be provably safe to run: `{from: 'prev'}` on the
 * first stage is a validation error (§6.1). The full compatibility walker
 * (§16.4), slot/context resolution, and schema-path checks are phase 2.
 */
@Injectable()
export class BlueprintValidatorService {
  validate(graph: StageDef[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (graph.length === 0) {
      issues.push({
        path: 'graph',
        message: 'a blueprint must declare at least one stage',
        severity: 'error',
      });
      return issues;
    }

    const firstStage = graph[0];
    if (firstStage) {
      for (const [name, ref] of [
        ...Object.entries(firstStage.slots),
        ...Object.entries(firstStage.context),
      ]) {
        if (ref.from === 'prev') {
          issues.push({
            path: `stages.${firstStage.key}.${name}`,
            message: '{from: "prev"} is invalid on the first stage in a blueprint',
            severity: 'error',
          });
        }
      }
    }

    const keys = new Set<string>();
    for (const stage of graph) {
      if (keys.has(stage.key)) {
        issues.push({
          path: `stages.${stage.key}`,
          message: `duplicate stage key "${stage.key}"`,
          severity: 'error',
        });
      }
      keys.add(stage.key);
    }

    return issues;
  }
}
