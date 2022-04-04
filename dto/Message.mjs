export class Message {

  #messageType;
  #message;

  /**
   * Constructor.
   *
   * @param {string} messageType 
   * @param {*} message 
   */
  constructor(messageType, message) {
    this.#messageType = messageType;
    this.#message = message;
  }

  getMessageType() {
    return this.#messageType;
  }

  getMessage() {
    return this.#message;
  }
}