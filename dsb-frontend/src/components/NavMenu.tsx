import { NavLink } from "react-router-dom";

export default function NavMenu() {
  return (
    <aside className="sidebar">
      <nav className="nav-menu">
        <NavLink
          to="/backlogs"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Backlogs
        </NavLink>

        <NavLink
          to="/boards"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Boards
        </NavLink>

        <NavLink
          to="/admin"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Admin
        </NavLink>
      </nav>
    </aside>
  );
}