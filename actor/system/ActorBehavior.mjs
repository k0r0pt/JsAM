import { Constants } from '../../constants/Constants.mjs';
import { Message } from '../../dto/Message.mjs';
import { MessageProcessingException } from '../../exception/MessageProcessingException.mjs';

export class ActorBehavior {

  _behaviorMapping = {};

  constructor() {
    this.on(Constants.TRANSFER_REQUEST_MSG_TYPE, (actor, msg) => {
      // TODO Transfer the actor.
    });
  }

  on(messageType, handler) {
    this._ensureHandlerIsFunction(handler);
    this._behaviorMapping[messageType] = handler;
    return this;
  }

  onMessage(handler) {
    this._ensureHandlerIsFunction(handler);
    this._behaviorMapping['default'] = handler;
    return this;
  }

  _ensureHandlerIsFunction(handler) {
    if (!(handler instanceof Function)) {
      throw new Error('Invalid behavior! Must be a function! Dahoy!');
    }
  }

  get(messageType) {
    return this._behaviorMapping[messageType];
  }

  /**
   * Processes the given message.
   *
   * @param {Message} message The message to be processed
   * @param {Actor} actorContext The {@link Actor} context it needs to be processed in
   * @throws {@link MessageProcessingException} If the behavior for the message type is not defined
   */
  process(message, actorContext) {
    var handler = this.get(message.getMessageType());
    if (!handler) {
      throw new MessageProcessingException('The Behavior for ' + message.getMessageType() + ' is not defined.');
    }
    handler(actorContext, message.getMessage(), message.getCallback());
  }
}
