/**
 * Actor Message Queue. Every Actor will have this. And this is where the messages will be enqueued.
 */
export class Queue {

  /**
   * Constructor. The parent must have a process() method for this to be able to invoke it.
   *
   * @param {*} parent The parent, which may be an Actor or a Special Actor
   */
  constructor(parent) {
    this.elements = {};
    this.head = 0;
    this.tail = 0;
    this.parent = parent;
  }

  enqueue(element, prioritize) {
    if (prioritize) {
      // Shift the elements and put the element at the head.
      for (var i = this.head; i <= this.tail; i++) {
        this.elements[i + 1] = this.elements[i];
      }
      this.elements[this.head] = element;
    } else {
      this.elements[this.tail] = element;
    }
    this.tail++;
    this.parent.process();
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