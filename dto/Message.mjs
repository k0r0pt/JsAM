export class Message {

  #messageType;
  #message;
  #callback;

  /**
   * Constructor.
   *
   * @param {string} messageType The Message Type
   * @param {*} message The Message to process
   * @param {Function} callback The callback function, in case it's an ask action
   */
  constructor(messageType, message, callback) {
    this.#messageType = messageType;
    this.#message = message;
    this.#callback = callback;
  }

  getMessageType() {
    return this.#messageType;
  }

  getMessage() {
    return this.#message;
  }

  getCallback() {
    return this.#callback;
  }
}