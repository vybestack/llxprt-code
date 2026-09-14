/**
 * @name Cancellation signal is not propagated
 * @description Finds a cancellation capability that never reaches the
 *              operation it should be able to cancel: a parameter whose
 *              declared type is the standard `AbortSignal` type (including
 *              through unions such as `AbortSignal | undefined`) is never
 *              referenced anywhere in the body of the function it belongs
 *              to (only parameters of functions with a body are
 *              considered, so interface methods and type-alias function
 *              types do not match vacuously, and conventionally unused
 *              parameters whose name starts with an underscore are
 *              skipped), or a variable initialized from
 *              `new AbortController()` whose `.signal` never reaches the
 *              argument list of any call, where the controller variable is
 *              not itself passed as a call argument and neither the
 *              controller nor its `.signal` is stored into a property or
 *              field, returned, embedded in an object literal, or passed
 *              to a call through a one-hop variable alias. Cooperative
 *              cancellation only works when the signal
 *              is actually handed to the cancellable operation or escaped
 *              where a cancellable operation can observe it.
 * @kind problem
 * @problem.severity warning
 * @id js/mechanism/cancellation-signal-not-propagated
 * @tags correctness
 *       reliability
 */

import javascript

/** Syntactic containment: `inner` is `outer` itself or a descendant of it. */
predicate containsAst(AstNode outer, AstNode inner) {
  outer = inner
  or
  exists(AstNode middle |
    middle = outer.getAChild() and
    containsAst(middle, inner)
  )
}

/**
 * Holds if the expression is a `new AbortController()` construction, the
 * standard way to obtain a cancellation capability. Resolve the constructor
 * value in the global scope, rather than matching a shadowing local class.
 */
predicate isAbortControllerConstruction(NewExpr construction) {
  construction.getCallee().(Identifier).getName() = "AbortController" and
  construction.getCallee().getNameBinding().hasQualifiedName("global", "AbortController")
}

/**
 * Holds for a parameter of a function that has a body: the parameter's
 * declared type is `AbortSignal`, it is not conventionally unused (no
 * leading underscore), and its variable is never referenced. Constructor
 * parameter-property observability through a same-named instance property
 * access in the same file also excludes the parameter from this check.
 */
predicate isUnpropagatedSignalParameter(SimpleParameter param) {
  param.getTypeAnnotation().hasUnderlyingType("AbortSignal") and
  param.getName().substring(0, 1) != "_" and
  // An empty block is still a body; signatures without bodies have no getBody() result.
  exists(param.getEnclosingFunction().getBody()) and
  not exists(param.getVariable().getAnAccess()) and
  not exists(ConstructorDeclaration constructor, PropAccess access |
    constructor.getBody() = param.getEnclosingFunction() and
    access.getBase() instanceof ThisExpr and
    access.getPropertyName() = param.getName() and
    access.getFile() = param.getFile()
  )
}

/**
 * Holds if a `.signal` read on the variable declared by `declarator`
 * reaches the argument list of some call, so the signal can be observed
 * by the callee. Containment inside an argument covers both direct
 * arguments and option-object shapes such as `{ signal: ctrl.signal }`.
 */
predicate signalReachesACall(VariableDeclarator declarator) {
  exists(PropAccess signalRead, InvokeExpr invocation, Expr argument |
    signalRead.getPropertyName() = "signal" and
    signalRead.getBase().(VarRef).getVariable() =
      declarator.getBindingPattern().(VarDecl).getVariable() and
    argument = invocation.getAnArgument() and
    containsAst(argument, signalRead)
  )
}

/** Holds if the controller variable itself reaches a call argument. */
predicate controllerReachesACall(VariableDeclarator declarator) {
  exists(InvokeExpr invocation, Expr argument, VarRef controllerRef |
    controllerRef.getVariable() = declarator.getBindingPattern().(VarDecl).getVariable() and
    argument = invocation.getAnArgument() and
    containsAst(argument, controllerRef)
  )
}

/**
 * Holds if the controller variable, or its `.signal`, is written into a
 * property or field: the value escapes and can be consumed elsewhere, so
 * it is not provably dead at this declaration.
 */
predicate controllerEscapesToField(VariableDeclarator declarator) {
  exists(AssignExpr write, Expr rhs, VarRef controllerRef |
    write.getLhs() instanceof PropAccess and
    rhs = write.getRhs() and
    controllerRef.getVariable() = declarator.getBindingPattern().(VarDecl).getVariable() and
    containsAst(rhs, controllerRef)
  )
  or
  exists(AssignExpr write, Expr rhs, PropAccess signalRead, VarRef controllerRef |
    write.getLhs() instanceof PropAccess and
    rhs = write.getRhs() and
    signalRead.getPropertyName() = "signal" and
    signalRead.getBase() = controllerRef and
    controllerRef.getVariable() = declarator.getBindingPattern().(VarDecl).getVariable() and
    containsAst(rhs, signalRead)
  )
}

/** Holds if the controller or its signal escapes through a return or object literal. */
predicate controllerEscapesToReturnOrObject(VariableDeclarator declarator) {
  exists(VarRef controllerRef |
    controllerRef.getVariable() = declarator.getBindingPattern().(VarDecl).getVariable() and
    (
      exists(ReturnStmt ret |
        ret.getContainer() = declarator.getEnclosingFunction() and
        containsAst(ret, controllerRef)
      )
      or
      exists(ObjectExpr object | containsAst(object, controllerRef))
    )
  )
}

/** Holds if a one-hop alias of the controller or its signal reaches a call argument. */
predicate controllerAliasReachesACall(VariableDeclarator declarator) {
  exists(
    VariableDeclarator alias, VarRef controllerRef, VarRef aliasRef, InvokeExpr invocation,
    Expr argument
  |
    controllerRef.getVariable() = declarator.getBindingPattern().(VarDecl).getVariable() and
    (
      alias.getInit() = controllerRef
      or
      exists(PropAccess signalRead |
        signalRead.getPropertyName() = "signal" and
        signalRead.getBase() = controllerRef and
        alias.getInit() = signalRead
      )
    ) and
    aliasRef.getVariable() = alias.getBindingPattern().(VarDecl).getVariable() and
    argument = invocation.getAnArgument() and
    containsAst(argument, aliasRef)
  )
}

from AstNode anchor
where
  anchor instanceof SimpleParameter and
  isUnpropagatedSignalParameter(anchor.(SimpleParameter))
  or
  anchor instanceof VariableDeclarator and
  isAbortControllerConstruction(anchor.(VariableDeclarator).getInit().(NewExpr)) and
  not signalReachesACall(anchor.(VariableDeclarator)) and
  not controllerReachesACall(anchor.(VariableDeclarator)) and
  not controllerEscapesToField(anchor.(VariableDeclarator)) and
  not controllerEscapesToReturnOrObject(anchor.(VariableDeclarator)) and
  not controllerAliasReachesACall(anchor.(VariableDeclarator))
select anchor,
  "Cancellation signal is not propagated: this AbortSignal-typed parameter or AbortController signal never reaches a call that could observe it, so the operation it should cancel cannot be cancelled."
