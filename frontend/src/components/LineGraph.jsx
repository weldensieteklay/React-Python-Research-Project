import {
    Chart as ChartJS,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Tooltip,
    Legend
  } from "chart.js";
  import { Line } from "react-chartjs-2";
  
 
  ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);
  
  const LineGraph = ({ data, dateColumn, endogenousColumn }) => {
    
    const chartData = {
      labels: data.map(row => new Date(row[dateColumn]).toLocaleDateString()), 
      datasets: [
        {
          label: endogenousColumn,
          data: data.map(row => Number(row[endogenousColumn])), 
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.3)",
          tension: 0.3
        }
      ]
    };
  
    const options = {
      responsive: true,
      plugins: {
        legend: { position: "top" },
        tooltip: { enabled: true }
      },
      scales: {
        x: {
          title: { display: true, text: dateColumn }
        },
        y: {
          title: { display: true, text: endogenousColumn }
        }
      }
    };
  
    return <Line data={chartData} options={options} />;
  };
  

export default LineGraph;