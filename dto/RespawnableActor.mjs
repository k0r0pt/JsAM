export class RespawnableActor {

  name;
  locator;
  behaviorDefinition;
  state;

  constructor(json) {
    this.name = json.name;
    this.locator = json.locator;
    this.behaviorDefinition = json.behaviorDefinition;
    this.state = json.state;
  }

  getName() {
    return this.name;
  }

  getLocator() {
    return this.locator;
  }

  getBehaviorDefinition() {
    return this.behaviorDefinition;
  }

  getState() {
    return this.state;
  }
}
