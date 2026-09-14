/**
 * @name Cleanup missing on an error path
 * @description Finds standard listener acquire/release pairs on the same
 *              receiver variable with equal string-literal event names in
 *              one function. A return or throw belonging to that function,
 *              or a catch body containing such an exit, lies between the
 *              calls and can skip the release. No finally block containing
 *              the release has a try statement beginning at or before that
 *              escape point.
 * @kind problem
 * @problem.severity warning
 * @id js/mechanism/cleanup-missing-on-error-path
 * @tags correctness
 *       reliability
 */

import javascript

/** Syntactic containment, used only for catch-body and finally-block subtrees. */
predicate containsAst(AstNode outer, AstNode inner) {
  outer = inner
  or
  exists(AstNode middle |
    middle = outer.getAChild() and
    containsAst(middle, inner)
  )
}

/**
 * Holds if the receiver resolves through standard type definitions to a
 * standard listener type, rather than an unrelated same-named method.
 */
predicate isStandardListenerReceiver(Expr receiver) {
  receiver.(VarRef).getTypeBinding().hasQualifiedName("EventTarget")
  or
  receiver.(VarRef).getTypeBinding().hasQualifiedName("EventEmitter")
  or
  receiver.(VarRef).getTypeBinding().hasQualifiedName("events", "EventEmitter")
  or
  // Imported type annotations can retain lexical identity without a qualified binding.
  exists(LocalTypeAccess type, ImportSpecifier spec |
    type = receiver.(VarRef).getTypeBinding() and
    type.getLocalTypeName().getADeclaration() = spec.getLocal() and
    spec.getImportedName() = "EventEmitter" and
    spec.getImportDeclaration().getImportedPathString() = ["events", "node:events"]
  )
}

/**
 * Holds if `call` registers or releases a listener on the local variable
 * `receiver`, with that variable resolving to a standard listener type.
 */
predicate listenerReceiverVariable(CallExpr call, Variable receiver) {
  receiver = call.getCallee().(PropAccess).getBase().(VarRef).getVariable() and
  isStandardListenerReceiver(call.getCallee().(PropAccess).getBase())
}

/**
 * Holds if the calls use matching standard listener lifecycle methods and
 * their first arguments are string literals with the same event-name value.
 */
predicate pairedLifecycleCalls(CallExpr acquire, CallExpr release) {
  acquire.getArgument(0).(StringLiteral).getValue() =
    release.getArgument(0).(StringLiteral).getValue() and
  (
    acquire.getCallee().(PropAccess).getPropertyName() = "addEventListener" and
    release.getCallee().(PropAccess).getPropertyName() = "removeEventListener"
    or
    acquire.getCallee().(PropAccess).getPropertyName() = "on" and
    release.getCallee().(PropAccess).getPropertyName() = "off"
  )
}

/**
 * Holds if a return or throw belonging directly to `f`, or a catch body
 * containing such an exit, lies between the calls. Statement `getContainer`
 * identifies the immediately enclosing function, excluding closure exits.
 */
predicate escapeBetween(Function f, CallExpr acquire, CallExpr release, AstNode escape) {
  (
    (escape instanceof ReturnStmt or escape instanceof ThrowStmt) and
    escape.(Stmt).getContainer() = f
    or
    exists(CatchClause catchClause, Stmt exit |
      escape = catchClause and
      catchClause.getContainer() = f and
      (exit instanceof ReturnStmt or exit instanceof ThrowStmt) and
      exit.getContainer() = f and
      containsAst(catchClause.getBody(), exit)
    )
  ) and
  acquire.getLocation().getStartLine() < escape.getLocation().getStartLine() and
  escape.getLocation().getStartLine() < release.getLocation().getStartLine()
}

/**
 * Holds if a finally block contains the release and its try statement belongs
 * directly to `f` and begins at or before the escape point. A later try cannot
 * protect a release skipped by an earlier escape.
 */
predicate finallyProtects(Function f, CallExpr release, AstNode escape) {
  exists(TryStmt tryStmt, Stmt finallyBlock |
    tryStmt.getContainer() = f and
    tryStmt.getLocation().getStartLine() <= escape.getLocation().getStartLine() and
    finallyBlock = tryStmt.getFinally() and
    containsAst(finallyBlock, release)
  )
}

from CallExpr acquire, CallExpr release, Function f, Variable receiver
where
  acquire.getEnclosingFunction() = f and
  release.getEnclosingFunction() = f and
  pairedLifecycleCalls(acquire, release) and
  listenerReceiverVariable(acquire, receiver) and
  listenerReceiverVariable(release, receiver) and
  acquire.getLocation().getStartLine() < release.getLocation().getStartLine() and
  exists(AstNode escape |
    escapeBetween(f, acquire, release, escape) and
    not finallyProtects(f, release, escape)
  )
select acquire,
  "Cleanup missing on an error path: the listener acquired here is released only on the normal path; a throw or early return between the acquire and the release skips the release call and no finally block protects it, so the registration leaks."
