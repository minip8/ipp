import java.util.*;

class UndergroundSystem {
    private record Trip(String station, int time) {}
    private record Route(String start, String end) {}

    private final Map<Integer, Trip> active = new HashMap<>();
    private final Map<Route, long[]> stats = new HashMap<>();  // {total, count}

    public UndergroundSystem() {}

    public void checkIn(int id, String stationName, int t) { active.put(id, new Trip(stationName, t)); }

    public void checkOut(int id, String stationName, int t) {
        Trip trip = active.remove(id);
        long[] s = stats.computeIfAbsent(new Route(trip.station(), stationName), k -> new long[2]);
        s[0] += t - trip.time();
        s[1]++;
    }

    public double getAverageTime(String startStation, String endStation) {
        long[] s = stats.get(new Route(startStation, endStation));
        return (double) s[0] / s[1];
    }
}

public class Main {
    public static void main(String[] args) {
        UndergroundSystem u = new UndergroundSystem();
        u.checkIn(1, "Bank", 3);
        u.checkIn(2, "Bank", 4);
        u.checkOut(1, "Oval", 15);
        u.checkOut(2, "Oval", 21);
        System.out.println(u.getAverageTime("Bank", "Oval"));
    }
}
