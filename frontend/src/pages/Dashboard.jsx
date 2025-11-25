import React from "react";
import { dashboardRoute } from "../constants/constants";
import { useNavigate } from "react-router-dom";
import { useUser }  from "../hooks/useUser";


const Dashboard = () => {
    const navigate = useNavigate();
    const { user, clearUser } = useUser();


    const onLogoutClick = () => {
        clearUser();       
        navigate("/");  
      };
   
  
    return (
        <>

            <aside className="absolute top-13 right-0 w-64 bg-white shadow-md p-4 flex flex-col items-center space-y-2 rounded-lg z-10">
               {user?.picture && (<img
               src={user?.picture}
               alt="Profile"
               className="w-12 h-12 rounded-full border border-gray-200 shadow-sm"
                /> )}
                <h2 className="text-lg font-semibold text-gray-800 text-center">
                    Hello, {user?.given_name}
                </h2>
                <p className="text-xs text-gray-500 text-center">{user?.email}</p>
                <button
                    onClick={onLogoutClick}
                    className="mt-2 px-3 py-1 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
                >
                    Logout
                </button>
            </aside>

            <main className="flex justify-center items-center h-[calc(100vh-160px)]">
                <div className="flex flex-wrap justify-center gap-8 max-w-6xl w-full">
                    {dashboardRoute.map((item, index) => {
                        const key = Object.keys(item)[0];
                        const { title, route } = item[key];
                        return (
                            <div
                                key={index}
                                className="w-80 h-40 bg-gray-50 flex items-center justify-center rounded-lg shadow-md hover:shadow-lg transition-all cursor-pointer"
                                onClick={() => navigate(route)}
                            >
                                <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
                            </div>
                        );
                    })}
                </div>
            </main>


        </>

    );
};

export default Dashboard;
