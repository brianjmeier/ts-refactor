import { createUser, getUserName, type UserProfile } from "./sample";

const user: UserProfile = createUser("Alice", "alice@example.com");
console.log(getUserName(user));
