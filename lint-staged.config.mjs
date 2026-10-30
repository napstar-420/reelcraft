// Pre-commit lint and format of the staged files (.husky/pre-commit): eslint
// and Prettier fix what they can. The hook then typechecks and runs the unit
// tests for the whole project. CI doesn't repeat these checks.
const code = /\.(c|m)?[jt]sx?$/;
const args = (files) => files.map((file) => JSON.stringify(file)).join(' ');

export default {
  '*': (files) => {
    const codeFiles = files.filter((file) => code.test(file));
    return [
      ...(codeFiles.length ? [`eslint --fix --no-warn-ignored ${args(codeFiles)}`] : []),
      `prettier --write --ignore-unknown ${args(files)}`,
    ];
  },
};
