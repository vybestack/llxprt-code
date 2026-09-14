/**
 * @name Unbounded accumulation
 * @description Finds a long-lived collection with standard-type-resolved
 *              append operations (`Array.push`, `Set.add`, `Map.set`) and
 *              no type-resolved truncation or eviction (`splice`, `shift`,
 *              `pop`, `clear`, `delete`, `truncate`) reaching the same
 *              per-file collection key, so entries are retained without
 *              bound. Replacing a collection with an empty array or a new
 *              collection, or a self-slice, counts as eviction except inside
 *              a method named
 *              constructor, where it is initialization. Only instance fields
 *              (`this.name`) count as long-lived; function-local accumulators
 *              are bounded by their own lifetime and are not reported.
 *              Keys combine the file path and structural field or variable
 *              name. Same-named fields within one file can still suppress
 *              each other, an accepted limitation for an advisory alert.
 * @kind problem
 * @problem.severity warning
 * @id js/mechanism/unbounded-accumulation
 * @tags reliability
 *       maintainability
 */

import javascript

/**
 * A per-file structural key for an instance field (`this.name`) or variable.
 * Same-named fields in different files have distinct identities; names within
 * a file may coincide. Only instance fields are reported as long-lived state.
 */
predicate collectionKey(Expr collection, string key) {
  exists(string name |
    (
      collection instanceof PropAccess and
      collection.(PropAccess).getBase() instanceof ThisExpr and
      name = "this." + collection.(PropAccess).getPropertyName()
      or
      collection instanceof VarRef and
      name = "variable:" + collection.(VarRef).getName()
    ) and
    key = collection.getLocation().getFile().getRelativePath() + ":" + name
  )
}

/**
 * Resolves collection identity from a type annotation or a same-class field
 * initializer, with a same-file field-name fallback for accesses in closures
 * or any method. Inferred field types are not supplied by the type-binding API.
 * The fallback shares the per-file collection key's name granularity.
 */
predicate hasCollectionType(Expr collection, string typeName) {
  collection.getTypeBinding().hasUnderlyingType(typeName)
  or
  exists(PropAccess access, FieldDeclaration field |
    access = collection and
    access.getBase() instanceof ThisExpr and
    (
      exists(MethodDeclaration method |
        method.getBody() = access.getEnclosingFunction() and
        field.getDeclaringClass() = method.getDeclaringClass()
      )
      or
      field.getFile() = access.getFile()
    ) and
    not field.isStatic() and
    field.getName() = access.getPropertyName() and
    (
      field.getInit().(NewExpr).getCallee().(GlobalVarAccess).getName() = typeName
      or
      typeName = "Array" and field.getInit() instanceof ArrayExpr
    )
  )
}

/** Append operations whose receiver resolves to the corresponding standard collection. */
predicate isAppendOperation(PropAccess callee) {
  callee.getPropertyName() = "push" and
  hasCollectionType(callee.getBase(), "Array")
  or
  callee.getPropertyName() = "add" and
  hasCollectionType(callee.getBase(), "Set")
  or
  callee.getPropertyName() = "set" and
  hasCollectionType(callee.getBase(), "Map")
}

/** Truncation or eviction on a type-resolved standard collection receiver. */
predicate isEvictionOperation(PropAccess callee) {
  callee.getPropertyName() = ["splice", "shift", "pop"] and
  hasCollectionType(callee.getBase(), "Array")
  or
  callee.getPropertyName() = ["clear", "delete"] and
  hasCollectionType(callee.getBase(), ["Set", "Map"])
  or
  callee.getPropertyName() = "truncate" and
  hasCollectionType(callee.getBase(), ["Array", "Set", "Map"])
}

/**
 * Replacing a collection with an empty array, a new collection, or a self-slice
 * counts as eviction under the same per-file key.
 * Only resets in provable named non-constructor methods count as eviction.
 * All other assignments are initialization, including class-field initializers
 * attributed to synthesized constructors and assignments whose enclosing
 * function cannot be attributed to a named non-constructor method.
 */
predicate isReassignmentEviction(string key) {
  exists(AssignExpr assignment |
    collectionKey(assignment.getLhs(), key) and
    exists(MethodDeclaration m |
      m.getBody() = assignment.getEnclosingFunction() and
      m.getName() != "constructor"
    ) and
    (
      exists(ArrayExpr array |
        array = assignment.getRhs() and
        not exists(array.getElement(_))
      )
      or
      exists(NewExpr construction |
        construction = assignment.getRhs() and
        construction.getCallee().(VarRef).getName() = ["Array", "Set", "Map"]
      )
      or
      exists(PropAccess rhsCallee |
        rhsCallee = assignment.getRhs().(CallExpr).getCallee() and
        rhsCallee.getPropertyName() = "slice" and
        collectionKey(rhsCallee.getBase(), key)
      )
    )
  )
}

from CallExpr append, string key
where
  isAppendOperation(append.getCallee().(PropAccess)) and
  append.getCallee().(PropAccess).getBase().(PropAccess).getBase() instanceof ThisExpr and
  collectionKey(append.getCallee().(PropAccess).getBase(), key) and
  not isReassignmentEviction(key) and
  not exists(CallExpr eviction |
    isEvictionOperation(eviction.getCallee().(PropAccess)) and
    collectionKey(eviction.getCallee().(PropAccess).getBase(), key)
  )
select append,
  "Unbounded accumulation: entries are appended to this long-lived collection and no truncation or eviction operation (splice, shift, pop, clear, delete, truncate) reaches the same per-file collection key, excluding constructor initialization, so it grows without bound."
