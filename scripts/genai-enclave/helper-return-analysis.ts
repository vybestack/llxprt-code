/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import ts from 'typescript';

interface ReturnFlow {
  readonly allValueReturnsProven: boolean;
  readonly canFallThrough: boolean;
  readonly hasValueReturn: boolean;
}

type ReturnExpressionProof = (expression: ts.Expression) => boolean;

const FALLTHROUGH: ReturnFlow = {
  allValueReturnsProven: true,
  canFallThrough: true,
  hasValueReturn: false,
};

function sequenceReturnFlow(
  statements: ts.NodeArray<ts.Statement>,
  proveExpression: ReturnExpressionProof,
): ReturnFlow {
  let allValueReturnsProven = true;
  let canFallThrough = true;
  let hasValueReturn = false;
  for (const statement of statements) {
    if (!canFallThrough) break;
    const flow = statementReturnFlow(statement, proveExpression);
    allValueReturnsProven = allValueReturnsProven && flow.allValueReturnsProven;
    canFallThrough = flow.canFallThrough;
    hasValueReturn = hasValueReturn || flow.hasValueReturn;
  }
  return { allValueReturnsProven, canFallThrough, hasValueReturn };
}

function statementReturnFlow(
  statement: ts.Statement,
  proveExpression: ReturnExpressionProof,
): ReturnFlow {
  if (ts.isReturnStatement(statement)) {
    return {
      allValueReturnsProven:
        statement.expression !== undefined &&
        proveExpression(statement.expression),
      canFallThrough: false,
      hasValueReturn: statement.expression !== undefined,
    };
  }
  if (ts.isThrowStatement(statement)) {
    return {
      allValueReturnsProven: true,
      canFallThrough: false,
      hasValueReturn: false,
    };
  }
  if (ts.isBlock(statement)) {
    return sequenceReturnFlow(statement.statements, proveExpression);
  }
  if (ts.isIfStatement(statement)) {
    const whenTrue = statementReturnFlow(
      statement.thenStatement,
      proveExpression,
    );
    const whenFalse =
      statement.elseStatement === undefined
        ? FALLTHROUGH
        : statementReturnFlow(statement.elseStatement, proveExpression);
    return {
      allValueReturnsProven:
        whenTrue.allValueReturnsProven && whenFalse.allValueReturnsProven,
      canFallThrough: whenTrue.canFallThrough || whenFalse.canFallThrough,
      hasValueReturn: whenTrue.hasValueReturn || whenFalse.hasValueReturn,
    };
  }
  const isNeutralDeclaration =
    ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement);
  const isNeutralStatement =
    ts.isExpressionStatement(statement) ||
    ts.isEmptyStatement(statement) ||
    ts.isDebuggerStatement(statement);
  if (isNeutralDeclaration || isNeutralStatement) return FALLTHROUGH;
  return {
    allValueReturnsProven: false,
    canFallThrough: true,
    hasValueReturn: false,
  };
}

export function functionReturnIsProven(
  body: ts.ConciseBody,
  proveExpression: ReturnExpressionProof,
): boolean {
  if (!ts.isBlock(body)) return proveExpression(body);
  const flow = sequenceReturnFlow(body.statements, proveExpression);
  return (
    flow.allValueReturnsProven && !flow.canFallThrough && flow.hasValueReturn
  );
}
