# weboak.py - Force-directed harmonic web visualization

# Necessary Imports
import networkx as nx
import matplotlib.pyplot as plt

def draw_force_directed_graph(input_graph):
    """
    Function to draw a force directed harmonic web (graph)
    input_graph: It is a NetworkX graph object
    """
    try:
        # Creating a spring layout
        pos = nx.spring_layout(input_graph, seed=7)  # Positions for all nodes - seed for reproducibility

        # Nodes
        nx.draw_networkx_nodes(input_graph, pos, node_size=700)

        # Edges
        nx.draw_networkx_edges(input_graph, pos, edgelist=input_graph.edges(), width=6)

        # Labels
        nx.draw_networkx_labels(input_graph, pos, font_size=20, font_family='sans-serif')

        # Display with Matplotlib
        plt.axis('off')  # Turn off axis
        plt.show()  # Show the plot
    except Exception as e:
        print("Error occurred: ", e)


if __name__ == "__main__":
    # Create a networkx graph object
    G = nx.Graph()

    # Adding nodes to the graph
    G.add_node(1)
    G.add_node(2)
    G.add_node(3)
    G.add_node(4)
    G.add_node(5)

    # Adding edges between nodes
    G.add_edge(1, 2)
    G.add_edge(1, 3)
    G.add_edge(2, 3)
    G.add_edge(3, 4)
    G.add_edge(4, 5)
    
    # Draw the force-directed harmonic web
    draw_force_directed_graph(G)
