package kr.gyeollon;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
@RestController
public class NavigationTicketController {
    private final NavigationTickets tickets;
    public NavigationTicketController(NavigationTickets tickets){this.tickets=tickets;}
    record Request(String ticket) {}
    @PostMapping("/api/navigation/resolve")
    public ResponseEntity<NavigationTickets.Resolved> resolve(@RequestBody Request request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer").body(tickets.resolve(request.ticket()));
    }
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Void> invalid(){return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).build();}
}
