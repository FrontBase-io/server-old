import { UserObjectType } from "../Types";

var bcrypt = require("bcryptjs");

// Vars
const salt = bcrypt.genSaltSync(10);

export const hashPassword = (password: string) => {
  return bcrypt.hashSync(password, salt);
};

export const comparePasswordToHash = (hash: string, password: string) => {
  return bcrypt.compareSync(password, hash);
};

export const getUserToken = (user: UserObjectType) => {
  return bcrypt.hashSync(
    `${process.env.SECRET}${new Date().getFullYear}${new Date().getMonth}${
      user.password
    }`,
    salt
  );
};

export const checkUserToken = (token: string, user: UserObjectType) => {
  return bcrypt.compareSync(
    `${process.env.SECRET}${new Date().getFullYear}${new Date().getMonth}${
      user.password
    }`,
    token
  );
};
