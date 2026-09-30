from tinyatlas import routing

SIZE = (1000.0, 1000.0)
# An L-shaped road (0,0)->(1,0)->(1,1) plus a short road that is NOT connected to it.
L_ROAD = [[(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)], [(1.0, 0.0), (1.0, 0.5), (1.0, 1.0)]]
ISLAND = [[(0.2, 0.9), (0.3, 0.95)]]


def test_graph_keeps_only_largest_component():
    g = routing.build_graph(L_ROAD + ISLAND, SIZE)
    assert (0.2, 0.9) not in g and (1.0, 1.0) in g and len(g) == 5


def test_route_follows_roads_not_straight_line():
    r = routing.route_through([(0.0, 0.0), (1.0, 1.0)], L_ROAD, SIZE, min_step=0.0)
    assert r[0] == [0.0, 0.0] and r[-1] == [1.0, 1.0]
    assert [1.0, 0.0] in r                        # goes via the corner, not the diagonal


def test_stop_off_road_snaps_to_nearest_road_vertex():
    r = routing.route_through([(0.02, 0.05), (0.98, 0.6)], L_ROAD, SIZE, min_step=0.0)
    assert r[0] == [0.0, 0.0] and r[-1] == [1.0, 0.5]


def test_no_roads_falls_back_to_the_stops_themselves():
    assert routing.route_through([(0.1, 0.1), (0.9, 0.9)], [], SIZE) == [[0.1, 0.1], [0.9, 0.9]]


def test_unreachable_node_gives_empty_path():
    g = routing.build_graph(L_ROAD, SIZE)
    assert routing.shortest_path(g, (0.0, 0.0), (0.7, 0.7)) == []


def test_best_order_uses_road_distance_not_straight_line():
    # U-shaped road: P0 and P1 are close as the crow flies (top of the two arms) but 2 km apart by road.
    u_road = [[(0.0, 0.5), (0.0, 0.0), (0.5, 0.0), (1.0, 0.0), (1.0, 0.5)]]
    pts = [(0.0, 0.5), (1.0, 0.5), (0.5, 0.0)]
    # from P0: visiting the base midpoint first (road 1.0 km + 1.0 km) beats going to P1 first (2.0 + 1.0).
    assert routing.best_order(pts, u_road, SIZE, start=0) == [0, 2, 1]


def test_best_order_is_a_permutation_starting_at_start():
    pts = [(0.1, 0.1), (0.5, 0.5), (0.9, 0.1), (0.3, 0.8)]
    o = routing.best_order(pts, L_ROAD, SIZE, start=2)
    assert sorted(o) == [0, 1, 2, 3] and o[0] == 2


def test_detour_legs_flags_paths_that_leave_the_map_and_return():
    legs = [12000.0, 107000.0, 8000.0, float("inf")]
    straights = [10000.0, 20000.0, 9000.0, 5000.0]
    assert routing.detour_legs(legs, straights) == [1, 3]           # 107 km for a 20 km hop; no connection at all
    assert routing.detour_legs([25000.0], [1000.0]) == []            # long but under the 30 km floor: a real long walk


def test_leg_lengths_are_road_distances_and_inf_when_unconnected():
    legs = routing.leg_lengths([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)], L_ROAD, SIZE)
    assert abs(legs[0] - 1000) < 1 and abs(legs[1] - 1000) < 1
    assert routing.leg_lengths([(0.0, 0.0), (1.0, 1.0)], [], SIZE) == [float("inf")]
