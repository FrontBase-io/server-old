/*
 * increase(value: number, increaseBy: number)
 * Convenience function that adds increaseBy to value
 */

class increase {
  // This is a preview for what will be returned from the function
  returnPreview = 0;
  // This variable holds dependencies
  dependencies = [];
  // Arguments
  arguments;

  // Preprocess the arguments
  constructor(args) {
    // If the arguments come as a number, save the number. If they come as a string, they still need to be parsed
    this.arguments = [
      typeof args[0] === "object" ? args[0].number : args[0],
      typeof args[1] === "object" ? args[1].number : args[1],
    ];
    // Arguments are only dependencies if they come in the form of a string. Otherwise, they're just numbers
    typeof args[0] === "string" && this.dependencies.push(args[0]);
    typeof args[1] === "string" && this.dependencies.push(args[1]);
  }

  // Resolves the function
  resolve = () =>
    new Promise<number>((resolve, reject) => {
      resolve((this.arguments[0] || 0) + (this.arguments[1] || 0));
    });
}

export default increase;
