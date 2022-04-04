export class FunctionSerDeser {
  static serialize(func) {
    return func.toString();
  }

  static deserialize(func) {
    return new Function('return ' + func)();
  }
}
