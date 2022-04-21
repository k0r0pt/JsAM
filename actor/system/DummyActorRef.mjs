export class DummyActorRef {

  /**
   * The constructor.
   *
   * @param {string} locator The actor locator in the Actor System
   */
  constructor(name, locator, behaviorDefinition) {
    this.name = name;
    this.locator = locator;
    this.behaviorDefinition = behaviorDefinition;
  }

  /**
   * Gets the Actor Locator.
   *
   * @returns the locator for this actor
   */
  getLocator() {
    return this.locator;
  }

  getName() {
    return this.name;
  }

  getBehaviorDefinition() {
    return this.behaviorDefinition;
  }
}