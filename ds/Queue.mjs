import { Actor } from '../actor/system/Actor.mjs';

/**
 * Actor Message Queue. Every Actor will have this. And this is where the messages will be enqueued.
 */
export class Queue {

  /**
   * Constructor.
   *
   * @param {Actor} parentActor 
   */
  constructor(parentActor) {
    this.elements = {};
    this.head = 0;
    this.tail = 0;
    this.parentActor = parentActor;
  }

  enqueue(element) {
    this.elements[this.tail] = element;
    this.tail++;
    this.parentActor.process();
  }

  dequeue() {
    const item = this.elements[this.head];
    delete this.elements[this.head];
    this.head++;
    return item;
  }

  peek() {
    return this.elements[this.head];
  }

  getLength() {
    return this.tail - this.head;
  }

  isEmpty() {
    return this.length === 0;
  }
}