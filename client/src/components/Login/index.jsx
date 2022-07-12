import React, { useState } from "react";
import "./styles.scss";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

export default function Login(props) {
  const [login, setLogin] = useState({ email: "", password: "" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  let modalClass = `popModal ${props.show}`;

  const submitLogin = function () {
    setLogin({ email: email, password: password });
    console.log(login);
  };

  return (
    <div className={modalClass}>
      <form
        className="formGroup"
        onSubmit={(e) => {
          e.preventDefault();
          submitLogin();
        }}
      >
        <FontAwesomeIcon
          className="close"
          icon={faXmark}
          onClick={() => {
            props.setShow("noShow");
          }}
        ></FontAwesomeIcon>
        <h2>LOGIN</h2>

        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <button className="btn" type="submit">
          Login
        </button>
      </form>
    </div>
  );
}