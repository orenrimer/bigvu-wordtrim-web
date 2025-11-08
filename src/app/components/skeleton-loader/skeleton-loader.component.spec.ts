import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SkeletonLoaderComponent } from './skeleton-loader.component';

describe('SkeletonLoaderComponent', () => {
    let component: SkeletonLoaderComponent;
    let fixture: ComponentFixture<SkeletonLoaderComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SkeletonLoaderComponent]
        }).compileComponents();

        fixture = TestBed.createComponent(SkeletonLoaderComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render skeleton items', () => {
        const compiled = fixture.nativeElement as HTMLElement;
        const skeletonChips = compiled.querySelectorAll('.skeleton-chip');
        expect(skeletonChips.length).toBe(20);
    });

    it('should have skeleton items with different widths', () => {
        const widths = component.skeletonItems.map(item => item.width);
        const uniqueWidths = new Set(widths);

        // Should have variety in widths (at least some different values)
        expect(uniqueWidths.size).toBeGreaterThan(1);
    });

    it('should have widths within expected range', () => {
        component.skeletonItems.forEach(item => {
            expect(item.width).toBeGreaterThanOrEqual(60);
            expect(item.width).toBeLessThanOrEqual(140);
        });
    });

    it('should have proper ARIA attributes for accessibility', () => {
        const compiled = fixture.nativeElement as HTMLElement;
        const loader = compiled.querySelector('.skeleton-loader');

        expect(loader?.getAttribute('role')).toBe('status');
        expect(loader?.getAttribute('aria-label')).toContain('Loading');
    });

    it('should have screen reader text', () => {
        const compiled = fixture.nativeElement as HTMLElement;
        const srText = compiled.querySelector('.sr-only');

        expect(srText?.textContent).toContain('Loading');
    });

    it('should render skeleton container with proper structure', () => {
        const compiled = fixture.nativeElement as HTMLElement;
        const container = compiled.querySelector('.skeleton-container');

        expect(container).toBeTruthy();
        expect(container?.children.length).toBe(20);
    });
});

